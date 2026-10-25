/**
 * 文献导入编排器
 *
 * 管线：元数据精修 → 结构化分块 → Contextual Chunking（Anthropic 2024）
 *      → 向量嵌入 → 入库（BM25 同步）→ 图谱抽取合并 → 社区摘要重建
 *
 * 每阶段通过 onProgress 回调上报，由 SSE 路由转发至前端实时进度条。
 */
import { randomUUID } from "crypto";
import { generateObject } from "ai";
import { z } from "zod";
import type { Chunk, Community, GraphEntity, GraphRelation, Paper } from "../types";
import type { IngestEvent } from "../types";
import { getEmbeddingChannel } from "../embeddings";
import { fastModel } from "../llm";
import { chunkPages, estimateTokens, heuristicMetadata, type RawPage } from "./chunker";
import { extractPaperGraph, summarizeCommunities } from "./graph-extract";
import { assignCommunities, buildCooccurrenceGraph } from "./cooccurrence";
import { getKB } from "./store";

type Progress = (e: IngestEvent) => void;

// ---------- 元数据精修 ----------

const MetaSchema = z.object({
  title: z.string().max(300),
  authors: z.array(z.string().max(80)).max(20),
  year: z.number().int().min(1900).max(2035).nullable(),
  venue: z.string().max(120).nullable(),
  abstract: z.string().max(1200).nullable(),
});

async function refineMetadata(pages: RawPage[], filename: string) {
  const heuristic = heuristicMetadata(pages);
  try {
    const { object } = await generateObject({
      model: fastModel(),
      schema: MetaSchema,
      prompt: `从这篇论文的首两页文本中抽取书目元数据。若无把握给 null，不要编造。文件名: ${filename}

首两页文本：
"""
${pages.slice(0, 2).map((p) => p.text).join("\n").slice(0, 6000)}
"""`,
    });
    return {
      title: object.title?.trim() || heuristic.title,
      authors: object.authors?.length ? object.authors : heuristic.authors,
      year: object.year ?? heuristic.year,
      venue: object.venue ?? undefined,
      abstract: object.abstract ?? heuristic.abstract,
      arxivId: heuristic.arxivId,
    };
  } catch {
    return { ...heuristic, venue: undefined };
  }
}

// ---------- Contextual Chunking（Anthropic Contextual Retrieval）----------

const ContextSchema = z.object({
  contexts: z.array(z.string().min(5).max(300)).min(1),
});

async function contextualizeChunks(
  paper: Paper,
  chunks: Chunk[],
  onProgress: Progress
): Promise<void> {
  const BATCH = 8;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    try {
      const { object } = await generateObject({
        model: fastModel(),
        schema: ContextSchema,
        prompt: `为论文《${paper.title}》的 ${batch.length} 个文本片段各生成一句简短的上下文定位说明（中文）。
说明该片段在论文中的位置（章节）和讨论的核心内容，使片段脱离全文后仍可被准确理解。
按顺序返回 ${batch.length} 条，与片段一一对应。

片段：
${batch.map((c, j) => `[${j + 1}] (${c.section ?? "第" + c.page + "页"}) ${c.rawText.slice(0, 400)}...`).join("\n\n")}`,
      });
      batch.forEach((c, j) => {
        const ctx = object.contexts[j];
        if (ctx) {
          c.contextPrefix = ctx.trim();
          c.text = `${ctx.trim()}\n${c.rawText}`;
        }
      });
    } catch {
      // LLM 失败时降级：用章节标题作上下文前缀（保持可检索性）
      batch.forEach((c) => {
        c.contextPrefix = `出自《${paper.title}》${c.section ?? `第${c.page}页`}。`;
        c.text = `${c.contextPrefix}\n${c.rawText}`;
      });
    }
    onProgress({
      type: "progress",
      stage: "contextual-chunking",
      percent: Math.min(100, Math.round(((i + BATCH) / chunks.length) * 100)),
      detail: `上下文增强 ${Math.min(i + BATCH, chunks.length)}/${chunks.length}`,
    });
  }
}

// ---------- 主入口 ----------

export interface IngestInput {
  filename: string;
  pages: RawPage[];
}

export async function ingestPaper(input: IngestInput, onProgress: Progress): Promise<Paper> {
  const kb = getKB();
  const paperId = randomUUID();

  onProgress({ type: "progress", stage: "metadata", percent: 5, detail: "抽取书目元数据…" });
  const meta = await refineMetadata(input.pages, input.filename);

  const paper: Paper = {
    id: paperId,
    title: meta.title,
    authors: meta.authors,
    year: meta.year,
    venue: meta.venue,
    arxivId: meta.arxivId,
    abstract: meta.abstract,
    filename: input.filename,
    pageCount: input.pages.length,
    chunkCount: 0,
    status: "processing",
    createdAt: new Date().toISOString(),
  };
  kb.upsertPaper(paper);

  // 分块
  onProgress({ type: "progress", stage: "chunking", percent: 15, detail: "结构化分块…" });
  const rawChunks = chunkPages(input.pages);
  if (rawChunks.length === 0) {
    paper.status = "error";
    paper.errorMessage = "未能从 PDF 中提取到有效文本（可能是扫描件，请尝试 OCR 后的版本）";
    kb.upsertPaper(paper);
    throw new Error(paper.errorMessage);
  }

  const chunks: Chunk[] = rawChunks.map((rc) => ({
    id: `${paperId}:${rc.index}`,
    paperId,
    index: rc.index,
    page: rc.page,
    section: rc.section,
    rawText: rc.text,
    text: rc.text,
    embeddingSource: "cloud",
    tokenEstimate: estimateTokens(rc.text),
  }));
  paper.chunkCount = chunks.length;

  // Contextual Chunking
  onProgress({ type: "progress", stage: "contextual-chunking", percent: 25, detail: "上下文增强分块…" });
  await contextualizeChunks(paper, chunks, onProgress);

  // 嵌入（先入 BM25 保证关键词可查，嵌入完成前即可用）
  kb.addChunks(chunks);
  onProgress({ type: "progress", stage: "embedding", percent: 45, detail: "生成向量嵌入…" });
  const channel = await getEmbeddingChannel();
  try {
    const texts = chunks.map((c) => c.text);
    const vectors = await channel.embed(texts);
    chunks.forEach((c, i) => {
      c.embedding = vectors[i];
      c.embeddingSource = channel.source;
    });
    kb.scheduleSave();
  } catch (err) {
    console.error("[ingest] embedding 失败:", err);
    // 嵌入失败不阻塞：BM25 仍可检索
  }

  // 图谱抽取
  onProgress({ type: "progress", stage: "graph-extraction", percent: 60, detail: "抽取实体与关系…" });
  let { entities, relations } = await extractPaperGraph(paper, chunks);
  if (entities.size === 0) {
    // 降级链：LLM 抽取不可用 → 术语共现图谱（真实语料构建，保证图谱页可用）
    const co = buildCooccurrenceGraph(paper.id, paper.title, chunks);
    entities = co.entities;
    relations = co.relations;
  }
  onProgress({
    type: "graph-done",
    entities: entities.size,
    relations: relations.size,
  });

  // 合并进全局图谱
  for (const [key, e] of entities) {
    const existing = kb.entities.get(key);
    if (existing) {
      for (const a of e.aliases) if (!existing.aliases.includes(a)) existing.aliases.push(a);
      for (const m of e.mentions) existing.mentions.push(m);
    } else {
      kb.entities.set(key, e);
    }
  }
  for (const [key, r] of relations) {
    const existing = kb.relations.get(key);
    if (existing) {
      existing.evidence.push(...r.evidence.slice(0, 3));
      existing.weight += r.weight;
    } else {
      kb.relations.set(key, r);
    }
  }

  // 社区摘要重建（全局）
  onProgress({ type: "progress", stage: "community-summary", percent: 85, detail: "重建主题社区…" });
  try {
    const communities = await summarizeCommunities(kb.entities, kb.relations);
    kb.communities = communities;
  } catch (err) {
    console.error("[ingest] 社区摘要失败:", err);
  }
  // LLM 社区摘要不可用/为空 → 共现模式 Louvain 直接分簇
  if (kb.communities.length === 0 && kb.entities.size > 0) {
    kb.communities = assignCommunities(kb.entities, kb.relations);
  }

  paper.status = "ready";
  kb.upsertPaper(paper);
  await kb.saveNow();

  onProgress({
    type: "done",
    paperId,
    title: paper.title,
    chunks: chunks.length,
    entities: entities.size,
    relations: relations.size,
  });
  return paper;
}
