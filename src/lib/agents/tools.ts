/**
 * Agentic RAG 工具集（chat 流式与 benchmark 批量共用）
 *
 * 五工具状态机：Adaptive-RAG 路由 / 混合检索 / CRAG 评分 / GraphRAG / Self-RAG 自评
 * 每请求一个上下文累加器（检索状态跨工具共享）。
 */
import { tool } from "ai";
import { generateObject } from "ai";
import { z } from "zod";
import { fastModel, NO_THINKING } from "../llm";
import { getKB } from "../kb/store";
import { expandQuery, retrieveHybrid, rerankCandidates, orderForContext } from "../retrieval/hybrid";
import { graphLocalSearch, graphGlobalSearch, serializeGraphContext } from "../retrieval/graph-search";
import type { RetrievedChunk } from "../types";

export interface RequestContext {
  lastRetrieved: RetrievedChunk[];
  retrievalRounds: number;
}

/** 检索上下文注入防护（AI 安全） */
export function sanitizeContext(text: string): string {
  return text
    .replace(
      /(ignore|disregard|forget)\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|context)/gi,
      "[filtered-injection]"
    )
    .replace(/忽略(之前|以上|上面|先前|前面)(的)?(所有|全部)?(指令|提示|规则|要求)/g, "[filtered-injection]")
    .replace(/\b(system|developer)\s*:\s*/gi, "")
    .slice(0, 2000);
}

export function buildAgentTools(ctx: RequestContext) {
  return {
    // Adaptive-RAG：查询复杂度分类路由
    classify_query: tool({
      description: "对用户问题进行复杂度分类并决定检索策略。每个新问题必须最先调用。",
      parameters: z.object({ question: z.string().describe("用户的问题") }),
      execute: async ({ question }) => {
        const ClassifySchema = z.object({
          complexity: z.string().nullable().optional(),
          reason: z.string().nullable().optional(),
          strategy: z.string().nullable().optional(),
        });
        const COMPLEXITIES = new Set(["chitchat", "simple", "factual", "multi-hop", "global-summary"]);
        const STRATEGIES = new Set([
          "direct-answer", "single-retrieval", "iterative-retrieval", "graph-local", "graph-global",
        ]);
        try {
          const { object } = await generateObject({
            providerOptions: NO_THINKING,
      model: fastModel(),
            schema: ClassifySchema,
            prompt: `对学术问答系统中的用户问题分类：
- chitchat: 寒暄、问系统功能本身
- simple: 通用常识，无需文献（如"什么是向量数据库"）
- factual: 需查文献的单点事实（某方法细节/数据集/实验数字）
- multi-hop: 跨论文比较、关联、推理（"X 和 Y 的区别"、"哪些工作用了 Z"）
- global-summary: 领域级综述、趋势、主题（"主要技术路线"）

问题: ${question}
输出 classification JSON。`,
          });
          return {
            complexity: COMPLEXITIES.has(object.complexity ?? "") ? object.complexity : "factual",
            reason: (object.reason ?? "").slice(0, 200),
            strategy: STRATEGIES.has(object.strategy ?? "") ? object.strategy : "single-retrieval",
          };
        } catch {
          return { complexity: "factual", reason: "分类降级：默认单轮检索", strategy: "single-retrieval" };
        }
      },
    }),

    // 混合检索：扩展 → 双路召回 → RRF → LLM 重排 → Lost-in-Middle 排序
    hybrid_retrieve: tool({
      description:
        "混合检索文献知识库（BM25+向量+HyDE，RRF 融合，LLM 重排序）。返回带编号的候选片段，回答时用 [编号] 引用。",
      parameters: z.object({
        query: z.string().describe("检索查询（应经过学术化改写）"),
        aim: z.string().max(120).optional().describe("本轮检索目的"),
      }),
      execute: async ({ query }) => {
        const kb = getKB();
        await kb.ensureLoaded();
        if (kb.chunks.size === 0) {
          return { candidates: [], note: "知识库为空：请先在文献库页面导入 PDF 论文。", fusedBy: "RRF" };
        }
        const expansion = await expandQuery(query);
        let fused = await retrieveHybrid(expansion, { topK: 8 });
        fused = await rerankCandidates(query, fused);
        const ordered = orderForContext(fused).slice(0, 8);
        ctx.lastRetrieved = ordered;
        ctx.retrievalRounds++;
        return {
          queryExpansion: {
            rewritten: expansion.rewrittenQuery,
            multiQueries: expansion.multiQueries,
            hydeUsed: !!expansion.hypotheticalAnswer,
          },
          fusedBy: "RRF",
          candidates: ordered.map((r, i) => ({
            no: i + 1,
            chunkId: r.chunk.id,
            paperTitle: r.paper.title,
            authors: r.paper.authors.slice(0, 3),
            year: r.paper.year,
            page: r.chunk.page,
            section: r.chunk.section,
            method: r.method,
            score: Number(r.score.toFixed(3)),
            text: sanitizeContext(r.chunk.text),
          })),
        };
      },
    }),

    // CRAG：候选逐条相关性评分，低分触发纠错
    grade_documents: tool({
      description:
        "对 hybrid_retrieve 返回的候选片段做相关性评分（0-10）。平均分<6 时应改写查询重新检索。",
      parameters: z.object({
        query: z.string(),
        chunkIds: z.array(z.string()).describe("hybrid_retrieve 返回的 chunkId 列表"),
      }),
      execute: async ({ query, chunkIds }) => {
        const kb = getKB();
        const grades: { chunkId: string; paperTitle: string; score: number; reason: string }[] = [];
        // flash 并发额度=1 → 逐条串行评分
        for (const cid of chunkIds) {
          const results = await Promise.all(
            [cid].map(async (cid) => {
              const chunk = kb.chunks.get(cid);
              if (!chunk) return null;
              const paper = kb.papers.get(chunk.paperId);
              try {
                const { object } = await generateObject({
                  providerOptions: NO_THINKING,
                  model: fastModel(),
                  schema: z.object({ score: z.number().nullable().optional(), reason: z.string().nullable().optional() }),
                  prompt: `问题: ${query}\n候选片段（${paper?.title} 第${chunk.page}页）:\n${chunk.text.slice(0, 600)}\n\n该片段对回答问题的相关性 0-10（10=直接包含答案，5=背景相关，0=无关）。输出 score 与一句话 reason（中文）。`,
                });
                return {
                  chunkId: cid,
                  paperTitle: paper?.title ?? "",
                  score: Math.max(0, Math.min(10, Math.round((object.score ?? 5) * 10) / 10)),
                  reason: (object.reason ?? "").slice(0, 150),
                };
              } catch {
                return { chunkId: cid, paperTitle: paper?.title ?? "", score: 5, reason: "评分降级：默认中等相关" };
              }
            })
          );
          for (const r of results) if (r) grades.push(r);
        }
        const averageScore = grades.length > 0 ? grades.reduce((s, g) => s + g.score, 0) / grades.length : 0;
        return {
          grades,
          averageScore: Number(averageScore.toFixed(2)),
          correctiveAction: averageScore >= 6 ? "accept" : grades.length === 0 ? "fallback-none" : "rewrite",
        };
      },
    }),

    // GraphRAG：Local 邻域 / Global 社区摘要
    graph_search: tool({
      description:
        "知识图谱检索。mode=local 查实体邻域（多跳关联）；mode=global 查社区摘要（领域综述）。",
      parameters: z.object({
        mode: z.enum(["local", "global"]),
        query: z.string().describe("聚焦的实体或主题"),
      }),
      execute: async ({ mode, query }) => {
        const kb = getKB();
        await kb.ensureLoaded();
        if (kb.entities.size === 0) {
          return { mode, entitiesHit: [], contextSummary: "知识图谱为空：图谱依赖文献导入时的实体抽取。" };
        }
        const graphCtx = mode === "local" ? graphLocalSearch(query, ctx.lastRetrieved) : graphGlobalSearch(query);
        const serialized = serializeGraphContext(graphCtx);
        return {
          mode,
          entitiesHit: graphCtx.entities.slice(0, 12).map((e) => ({ name: e.name, type: e.type, mentions: e.mentions.length })),
          relations:
            graphCtx.relations.slice(0, 12).map((r) => ({
              source: r.sourceId,
              label: r.label,
              target: r.targetId,
              evidenceCount: r.evidence.length,
            })),
          communities: graphCtx.communities?.map((c) => ({ size: c.size, summary: c.summary?.slice(0, 300) })) ?? [],
          contextSummary: serialized.slice(0, 2200),
        };
      },
    }),

    // Self-RAG：生成前支撑度自评
    self_assess: tool({
      description:
        "输出最终回答前调用：提交关键论断，系统验证其是否被候选证据支撑。score>=7 才可输出强断言。",
      parameters: z.object({
        claims: z.array(z.string()).min(1).max(8).describe("关键论断列表"),
        usedCandidateNos: z.array(z.number()).describe("依赖的候选编号"),
      }),
      execute: async ({ claims, usedCandidateNos }) => {
        const used = ctx.lastRetrieved.filter((_, idx) => usedCandidateNos.includes(idx + 1));
        if (used.length === 0) {
          return {
            supportScore: claims.length === 0 ? 8 : 3,
            isGrounded: false,
            needsMoreRetrieval: claims.length > 0,
            verdict: "未绑定任何检索证据，请检索后作答或明确说明基于通用知识。",
          };
        }
        const evidence = used.map((u) => u.chunk.text.slice(0, 500)).join("\n---\n").slice(0, 3200);
        try {
          const { object } = await generateObject({
            providerOptions: NO_THINKING,
      model: fastModel(),
            schema: z.object({ supportScore: z.number().nullable().optional(), verdict: z.string().nullable().optional() }),
            prompt: `论断列表:\n${claims.map((cl, i) => `${i + 1}. ${cl}`).join("\n")}\n\n检索证据:\n${evidence}\n\n每条论断是否能被证据直接支撑？给总支撑度 0-10，并用一句话中文说明哪些论断缺证据。`,
          });
          const supportScore = Math.max(0, Math.min(10, Math.round((object.supportScore ?? 6) * 10) / 10));
          return {
            supportScore,
            isGrounded: supportScore >= 7,
            needsMoreRetrieval: supportScore < 6,
            verdict: (object.verdict ?? "").slice(0, 200),
          };
        } catch {
          return { supportScore: 6, isGrounded: true, needsMoreRetrieval: false, verdict: "自评降级：默认中等支撑，请谨慎措辞。" };
        }
      },
    }),
  };
}

export const AGENT_SYSTEM_PROMPT = `你是 PaperPilot，面向学术文献知识库的智能问答助手。你必须严格执行 Agentic RAG 工作流：

## 第一步：分类（必须最先执行）
收到每个新问题后，立即调用 classify_query 判断复杂度。

## 第二步：按分类路由（Adaptive-RAG, NAACL 2024）
- chitchat（寒暄/关于系统本身）→ 直接文本回答，不检索
- simple（常识问题，无需文献）→ 直接回答并注明"基于通用知识"
- factual（单点事实：某方法/数据集/数字）→ 调用 hybrid_retrieve → 依证据回答
- multi-hop（跨论文比较/关联推理）→ hybrid_retrieve 与 graph_search(mode="local") 并用；若证据不足，改写关键词再次 hybrid_retrieve（累计不超过 2 轮）
- global-summary（领域综述/趋势类）→ 调用 graph_search(mode="global")

## 第三步：证据质量控制（CRAG）
hybrid_retrieve 返回候选后，若你看不出明确相关片段，调用 grade_documents 对候选打分：
- 平均分 ≥ 6 → 采纳，直接进入回答
- 平均分 < 6 → 换角度改写后再次 hybrid_retrieve；第二轮仍不足 → 明确说明证据不足

## 第四步：回答规范（忠实度优先）
- 引用格式：在论断后标注 [n]，n 对应 hybrid_retrieve 候选编号，可多引如 [1][3]
- 【最高优先级】只陈述候选片段中可直接找到依据的内容：所有数字、结论、方法名必须来自片段原文；片段没有的信息宁可说"知识库中未找到充分依据"，也绝不推测或补充背景知识
- 回答保持克制：短段落/要点式，逐条对应证据；不确定的表述用"根据 [n]，……"，不要外推
- 证据不足时必须回答："知识库中未找到充分依据……"并给出最接近的部分信息，严禁编造论文、数据或数字
- 用中文回答，术语保留英文原文
- 涉及图谱推理结论时注明"（知识图谱推理）"

## 第五步：自评（Self-RAG，回答前最后一步）
调用 self_assess 提交你的关键论断与使用的候选编号：
- 支撑度 ≥ 8 → 输出最终回答
- 支撑度 6-7 → 弱化断言（"根据现有证据，倾向于……"）后输出
- 支撑度 < 6 → 补充检索一轮；仍不足则明确回答证据不足

当前知识库状态由工具实时返回。回答保持学术、克制、可溯源。`;
