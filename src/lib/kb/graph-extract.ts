/**
 * GraphRAG 构建管线（Microsoft GraphRAG 思想 + 轻量化改造）
 *
 * 1. 逐 chunk LLM 抽取实体与关系（generateObject 强约束 JSON 输出）
 * 2. 跨 chunk / 跨论文规范化合并（大小写折叠、别名吸收、证据链累积）
 * 3. Louvain 社区发现 → 主题社区
 * 4. LLM 社区摘要（Global Search 的检索单元，arXiv:2404.16130）
 */
import { generateObject } from "ai";
import { z } from "zod";
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import type { Chunk, Community, EntityType, GraphEntity, GraphRelation, Paper } from "../types";
import { chatModel, fastModel, NO_THINKING } from "../llm";

const ENTITY_TYPES: EntityType[] = [
  "method", "dataset", "metric", "model", "task", "finding", "author", "institution",
];

/**
 * 面向 LLM 的宽松 schema：不在模型输出上做严格 max/min/enum 约束
 * （任何越界值都会让 zod 整体校验失败，长文本下几乎必失败），
 * 业务净化（截断/类型映射/过滤）在 sanitizeExtraction 中完成。
 */
const RawExtractionSchema = z.object({
  entities: z.array(
    z.object({
      name: z.string().nullable().optional(),
      type: z.string().nullable().optional(),
      aliases: z.array(z.string().nullable()).optional(),
    })
  ),
  relations: z.array(
    z.object({
      source: z.string().nullable().optional(),
      target: z.string().nullable().optional(),
      label: z.string().nullable().optional(),
      sentence: z.string().nullable().optional(),
    })
  ),
});

interface Extraction {
  entities: { name: string; type: EntityType; aliases: string[] }[];
  relations: { source: string; target: string; label: string; sentence: string }[];
}

const VALID_TYPES = new Set<string>(ENTITY_TYPES);

/** LLM 原始输出 → 净化后的合规抽取（截断、非法类型映射、空值过滤） */
function sanitizeExtraction(raw: z.infer<typeof RawExtractionSchema>): Extraction {
  const entities = (raw.entities ?? [])
    .map((e) => ({
      name: (e.name ?? "").trim().slice(0, 80),
      type: (VALID_TYPES.has(e.type ?? "") ? e.type : "method") as EntityType,
      aliases: (e.aliases ?? [])
        .map((a) => (a ?? "").trim().slice(0, 80))
        .filter(Boolean)
        .slice(0, 5),
    }))
    .filter((e) => e.name.length > 0)
    .slice(0, 20);
  const validNames = new Set(entities.map((e) => e.name.toLowerCase()));
  const relations = (raw.relations ?? [])
    .map((r) => ({
      source: (r.source ?? "").trim().slice(0, 80),
      target: (r.target ?? "").trim().slice(0, 80),
      label: (r.label ?? "").trim().slice(0, 40) || "related-to",
      sentence: (r.sentence ?? "").slice(0, 400),
    }))
    .filter(
      (r) =>
        r.source &&
        r.target &&
        validNames.has(r.source.toLowerCase()) &&
        validNames.has(r.target.toLowerCase())
    )
    .slice(0, 15);
  return { entities, relations };
}

export interface GraphBuildResult {
  entities: GraphEntity[];
  relations: GraphRelation[];
  communities: Community[];
}

/** 名称规范化键：Latin 折叠小写去符号；CJK 保留 */
export function normalizeName(name: string): string {
  const trimmed = name.trim();
  const hasCJK = /[\u4e00-\u9fff]/.test(trimmed);
  if (hasCJK) return trimmed.toLowerCase();
  return trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** 单 chunk 抽取（含 429 限流指数退避重试） */
async function extractChunk(paper: Paper, chunk: Chunk): Promise<Extraction> {
  const text = chunk.text.slice(0, 3500);
  const prompt = `你是一个学术知识图谱构建器。从以下论文片段中抽取实体与关系。

论文标题: ${paper.title}
章节: ${chunk.section ?? "未知"} (第${chunk.page}页)

【实体类型说明】
- method: 方法/技术（如 Self-RAG, BM25, 混合检索）
- dataset: 数据集（如 HotpotQA, MS MARCO）
- metric: 评价指标（如 EM, F1, Recall@k）
- model: 模型（如 GPT-4, LLaMA）
- task: 任务（如 问答, 机器翻译）
- finding: 关键研究结论（一句话概括）
- author: 作者名
- institution: 机构名

【关系谓词示例】proposes(提出), evaluated-on(评测于), outperforms(优于), uses(使用), achieves(达到), compares-with(对比), extends(扩展)

规则：
1. 只抽取文中明确出现的实体，不要推测
2. 关系的 source/target 必须都在实体列表中
3. sentence 给出原文中最能支撑该关系的句子（截取关键部分）
4. 跳过参考文献列表、页眉页脚

论文片段：
"""
${text}
"""`;

  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const { object } = await generateObject({
        providerOptions: NO_THINKING,
        model: fastModel(),
        schema: RawExtractionSchema,
        prompt,
      });
      return sanitizeExtraction(object);
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("429") || /rate|速率|1302|1305/.test(msg)) {
        await new Promise((r) => setTimeout(r, [5000, 15000, 60000, 120000][attempt] ?? 180000));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

/** 合并单篇文献的全部抽取结果 → 实体/关系映射（以规范键为键） */
export async function extractPaperGraph(
  paper: Paper,
  chunks: Chunk[],
  concurrency = 1
): Promise<{ entities: Map<string, GraphEntity>; relations: Map<string, GraphRelation> }> {
  const entities = new Map<string, GraphEntity>();
  const relations = new Map<string, GraphRelation>();
  // 参考文献块对图谱无贡献（且占篇幅 20-30%），直接跳过以省配额与时间
  const usable = chunks.filter(
    (c) => !/references?|bibliography|参考文献/i.test(c.section ?? "")
  );
  const queue = [...usable];
  let failures = 0;

  const worker = async () => {
    while (queue.length > 0) {
      const chunk = queue.shift();
      if (!chunk) break;
      // 限速间隔：免费档 flash 高频持续调用会触发 1302
      await new Promise((r) => setTimeout(r, 1500));
      let ext: Extraction | null = null;
      try {
        ext = await extractChunk(paper, chunk);
      } catch (err) {
        failures++;
        const msg = err instanceof Error ? err.message : String(err);
        const cause = err instanceof Error && err.cause ? String(err.cause) : "";
        console.warn(`[graph] chunk失败: ${msg.slice(0, 150)} | cause: ${cause.slice(0, 150)}`);
        continue;
      }
      if (!ext) continue;

      for (const e of ext.entities) {
        const key = normalizeName(e.name);
        if (!key) continue;
        const existing = entities.get(key);
        if (existing) {
          // 别名吸收：保留更长的展示名为主名
          if (e.name.length > existing.name.length && e.name.length <= 50) {
            existing.aliases.push(existing.name);
            existing.name = e.name;
          } else if (!existing.aliases.includes(e.name) && e.name !== existing.name) {
            existing.aliases.push(e.name);
          }
          for (const a of e.aliases ?? []) {
            if (!existing.aliases.includes(a) && a !== existing.name) existing.aliases.push(a);
          }
          const mention = existing.mentions.find((m) => m.paperId === paper.id);
          if (mention) {
            if (!mention.chunkIds.includes(chunk.id)) mention.chunkIds.push(chunk.id);
            mention.count++;
          } else {
            existing.mentions.push({ paperId: paper.id, chunkIds: [chunk.id], count: 1 });
          }
        } else {
          entities.set(key, {
            id: key,
            name: e.name,
            type: ENTITY_TYPES.includes(e.type) ? e.type : "method",
            aliases: e.aliases ?? [],
            mentions: [{ paperId: paper.id, chunkIds: [chunk.id], count: 1 }],
          });
        }
      }

      for (const r of ext.relations) {
        const sKey = normalizeName(r.source);
        const tKey = normalizeName(r.target);
        if (!sKey || !tKey || sKey === tKey) continue;
        if (!entities.has(sKey) || !entities.has(tKey)) continue; // 端点必须存在
        const relId = `${sKey}→${r.label}→${tKey}`;
        const existing = relations.get(relId);
        const evidence = { paperId: paper.id, chunkId: chunk.id, sentence: r.sentence.slice(0, 300) };
        if (existing) {
          if (existing.evidence.length < 8) existing.evidence.push(evidence);
          existing.weight++;
        } else {
          relations.set(relId, {
            id: relId,
            sourceId: sKey,
            targetId: tKey,
            label: r.label,
            evidence: [evidence],
            weight: 1,
          });
        }
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, usable.length) }, worker));
  if (failures > 0) console.warn(`[graph] ${paper.title}: ${failures}/${chunks.length} chunk 抽取失败（已跳过）`);
  return { entities, relations };
}

/** Louvain 社区发现（在实体图上） */
export function detectCommunities(
  entities: Map<string, GraphEntity>,
  relations: Map<string, GraphRelation>
): Map<string, number> {
  const graph = new Graph({ multi: false, type: "directed" });
  for (const e of entities.values()) {
    graph.addNode(e.id, { weight: Math.max(1, e.mentions.reduce((s, m) => s + m.count, 0)) });
  }
  for (const r of relations.values()) {
    if (!graph.hasEdge(r.sourceId, r.targetId)) {
      graph.addEdge(r.sourceId, r.targetId, { weight: r.weight });
    }
  }
  if (graph.order === 0) return new Map();
  try {
    // louvain 返回普通对象 { [nodeId]: communityId }
    const assignment = louvain(graph) as unknown as Record<string, number>;
    return new Map(Object.entries(assignment ?? {}));
  } catch {
    return new Map();
  }
}

/** LLM 生成社区主题摘要（Global Search 检索单元） */
export async function summarizeCommunities(
  entities: Map<string, GraphEntity>,
  relations: Map<string, GraphRelation>,
  maxCommunities = 12
): Promise<Community[]> {
  const assignment = detectCommunities(entities, relations);
  const byCommunity = new Map<number, string[]>();
  for (const [entityId, cid] of assignment) {
    if (!byCommunity.has(cid)) byCommunity.set(cid, []);
    byCommunity.get(cid)!.push(entityId);
  }
  // 过滤孤立社区并按规模排序
  const sorted = [...byCommunity.entries()]
    .map(([cid, ids]) => ({ cid, ids: ids.filter((id) => entities.has(id)) }))
    .filter((c) => c.ids.length >= 2)
    .sort((a, b) => b.ids.length - a.ids.length)
    .slice(0, maxCommunities);

  const communities: Community[] = [];
  for (const { cid, ids } of sorted) {
    const members = ids.map((id) => entities.get(id)!);
    const memberDesc = members
      .slice(0, 25)
      .map((m) => `${m.name}(${m.type})`)
      .join(", ");
    let summary: string | undefined;
    try {
      const { text } = await generateTextSafe(
        `以下是一组学术知识图谱中同属一个主题社区的实体（括号内为类型）。用2-3句中文概括这一社区代表的研究主题、技术路线或关注点，不要列举实体本身，直接输出概括内容。\n\n实体: ${memberDesc}`
      );
      summary = text;
    } catch {
      summary = undefined;
    }
    for (const m of members) m.communityId = communities.length;
    communities.push({ id: communities.length, entityIds: ids, summary, size: ids.length });
  }
  return communities;
}

async function generateTextSafe(prompt: string): Promise<{ text: string }> {
  const { generateText } = await import("ai");
  const { text } = await generateText({
    providerOptions: NO_THINKING,
    model: fastModel(),
    prompt,
    maxTokens: 300,
  });
  return { text: text.trim() };
}
