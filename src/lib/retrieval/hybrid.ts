/**
 * 混合检索管线（M3）
 *
 * ┌─ 查询扩展：口语→学术重写 + 3 视角多查询（RAG-Fusion）+ HyDE 假设文档（arXiv:2212.10496）
 * ├─ 双路召回：BM25 关键词 × N + 向量语义 × N（每路每个查询变体独立打分）
 * ├─ RRF 融合：score = Σ 1/(k + rank)，k=60（Reciprocal Rank Fusion）
 * ├─ LLM Listwise 重排序：cross-encoder 替代方案（智谱 glm-4-flash）
 * └─ Lost in the Middle 重排：最强证据置于上下文首尾（arXiv:2307.03172）
 */
import { generateObject } from "ai";
import { z } from "zod";
import type { Chunk, Paper, RetrievedChunk, RewriteStepResult } from "../types";
import { getEmbeddingChannel } from "../embeddings";
import { fastModel } from "../llm";
import { getKB } from "../kb/store";

// ---------- 1. 查询扩展 ----------

const ExpandSchema = z.object({
  rewrittenQuery: z.string().max(300),
  multiQueries: z.array(z.string().max(300)).length(3),
  hypotheticalAnswer: z.string().max(800),
});

export async function expandQuery(query: string, conversationContext?: string): Promise<RewriteStepResult> {
  try {
    const { object } = await generateObject({
      model: fastModel(),
      schema: ExpandSchema,
      prompt: `你是学术检索查询优化器。用户正在向一个学术论文知识库提问（语料为 RAG/LLM 领域论文）。

用户问题: ${query}
${conversationContext ? `对话上文（如需指代消解）: ${conversationContext.slice(-600)}` : ""}

任务：
1. rewrittenQuery：把问题重写为适合检索的学术化查询（中英混合可保留术语原文，指代消解）
2. multiQueries：3 个不同视角的等价检索查询（如：方法视角、数据/实验视角、问题定义视角）
3. hypotheticalAnswer：直接写一段假设性的答案段落（80-150字，包含可能的方法名/数据集名/数字，即使不确定也写出最可能的表述）——它将被用于向量检索而非展示（HyDE 技术）

只输出 JSON。`,
    });
    return {
      originalQuery: query,
      rewrittenQuery: object.rewrittenQuery,
      multiQueries: object.multiQueries,
      hypotheticalAnswer: object.hypotheticalAnswer,
    };
  } catch {
    // 降级：原查询直检
    return {
      originalQuery: query,
      rewrittenQuery: query,
      multiQueries: [],
      hypotheticalAnswer: undefined,
    };
  }
}

// ---------- 2. 双路召回 + RRF 融合 ----------

const RRF_K = 60;

export interface HybridOptions {
  topK?: number;
  candidatePerQuery?: number;
  filterPaperIds?: Set<string>;
}

export async function retrieveHybrid(
  expansion: RewriteStepResult,
  options: HybridOptions = {}
): Promise<RetrievedChunk[]> {
  const kb = getKB();
  await kb.ensureLoaded();
  const topK = options.topK ?? 8;
  const perQuery = options.candidatePerQuery ?? 10;

  const queryVariants = [
    expansion.rewrittenQuery,
    ...expansion.multiQueries.slice(0, 3),
  ].filter(Boolean);

  // BM25 路（同步、零成本）
  const bm25Lists: string[][] = [];
  for (const q of queryVariants) {
    bm25Lists.push(
      kb.bm25Search(q, perQuery, options.filterPaperIds).map((c) => c.id)
    );
  }

  // 向量路（一次嵌入所有查询变体 + HyDE 文档）
  const vectorLists: string[][] = [];
  const channel = await getEmbeddingChannel();
  const embedTargets = [...queryVariants];
  if (expansion.hypotheticalAnswer) embedTargets.push(expansion.hypotheticalAnswer);
  const embedKind = (i: number): "query" | "passage" =>
    expansion.hypotheticalAnswer && i === embedTargets.length - 1 ? "passage" : "query";
  try {
    const embeddings = await Promise.all(
      embedTargets.map((t, i) => channel.embed([t], embedKind(i)).then((v) => v[0]))
    );
    for (const emb of embeddings) {
      vectorLists.push(
        kb.vectorSearch(emb, perQuery, options.filterPaperIds).map((c) => c.id)
      );
    }
  } catch {
    // 嵌入不可用 → 仅 BM25
  }

  // RRF 融合
  const fused = new Map<string, { score: number; methods: Set<string> }>();
  const addList = (list: string[], method: string) => {
    list.forEach((chunkId, rank) => {
      const entry = fused.get(chunkId) ?? { score: 0, methods: new Set<string>() };
      entry.score += 1 / (RRF_K + rank + 1);
      entry.methods.add(method);
      fused.set(chunkId, entry);
    });
  };
  bm25Lists.forEach((l) => addList(l, "bm25"));
  vectorLists.forEach((l, i) =>
    addList(l, i === vectorLists.length - 1 && expansion.hypotheticalAnswer ? "hyde" : "vector")
  );

  const ranked = [...fused.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, topK * 2) // 留候选给重排序
    .map(([chunkId, v]) => {
      const chunk = kb.chunks.get(chunkId)!;
      const method = v.methods.has("hyde")
        ? ("hyde" as const)
        : v.methods.size > 1
          ? ("vector" as const)
          : ([...v.methods][0] as "vector" | "bm25");
      return { chunk, paper: kb.papers.get(chunk.paperId)!, score: v.score, method };
    })
    .filter((r) => r.chunk && r.paper);

  return ranked;
}

// ---------- 3. LLM Listwise 重排序 ----------

const RerankSchema = z.object({
  rankings: z.array(z.object({ id: z.string(), relevance: z.number().min(0).max(10) })).min(1),
});

export async function rerankCandidates(
  query: string,
  candidates: RetrievedChunk[]
): Promise<RetrievedChunk[]> {
  if (candidates.length <= 1) return candidates;
  try {
    const { object } = await generateObject({
      model: fastModel(),
      schema: RerankSchema,
      prompt: `对以下检索候选片段按与问题的相关性打分（0-10，10=直接回答问题，5=部分相关，0=无关）。

问题: ${query}

候选片段：
${candidates
  .map(
    (c, i) =>
      `[${c.chunk.id}] (${c.paper.title} 第${c.chunk.page}页) ${c.chunk.text.slice(0, 350)}`
  )
  .join("\n\n")}

输出每个片段的 id 与相关性分数。`,
    });
    const scoreMap = new Map(object.rankings.map((r) => [r.id, r.relevance]));
    return candidates
      .map((c) => ({ ...c, score: scoreMap.get(c.chunk.id) ?? c.score }))
      .sort((a, b) => b.score - a.score);
  } catch {
    return candidates; // 降级：保持 RRF 序
  }
}

// ---------- 4. Lost in the Middle 上下文重排 ----------

/**
 * LLM 对长上下文中间部分注意力最弱（arXiv:2307.03172）。
 * 将证据按相关性蛇形分配：最强在头、次强在尾、依次向中间收缩。
 */
export function orderForContext(items: RetrievedChunk[]): RetrievedChunk[] {
  const sorted = [...items].sort((a, b) => b.score - a.score);
  const head: RetrievedChunk[] = [];
  const tail: RetrievedChunk[] = [];
  sorted.forEach((item, i) => {
    if (i % 2 === 0) head.push(item);
    else tail.unshift(item);
  });
  return [...head, ...tail].map((c, i) => ({ ...c, rank: i + 1 }));
}

// ---------- 组装引用 ----------

export function buildCitations(items: RetrievedChunk[], maxCitations = 6) {
  return items.slice(0, maxCitations).map((r, i) => ({
    no: i + 1,
    paperId: r.paper.id,
    paperTitle: r.paper.title,
    page: r.chunk.page,
    section: r.chunk.section,
    chunkId: r.chunk.id,
    quote: r.chunk.rawText.slice(0, 260),
    score: Number(r.score.toFixed(4)),
  }));
}
