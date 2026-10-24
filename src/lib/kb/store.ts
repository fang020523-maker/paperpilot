/**
 * 知识库单例（服务端）
 *
 * 设计考量（赛题：后端刻意轻薄）：
 * - 全量内存索引：文献规模 30-50 篇 / 数千 chunk，暴力余弦扫描毫秒级完成，
 *   免去外部数据库依赖（部署 Vercel 亦可跑）
 * - globalThis 单例：免疫 Next.js dev 热重载造成的实例重建
 * - JSON 快照持久化到 .data/knowledge-base.json，重启秒级恢复
 * - BM25 索引随 chunk 增删实时维护
 */
import fs from "fs/promises";
import path from "path";
import type { Chunk, Community, GraphEntity, GraphRelation, Paper } from "../types";
import { BM25Index } from "../retrieval/bm25";
import { cosineSim } from "../embeddings";

const DATA_DIR = path.join(process.cwd(), ".data");
const KB_FILE = path.join(DATA_DIR, "knowledge-base.json");

interface KBSnapshot {
  version: 1;
  papers: Paper[];
  chunks: Chunk[];
  entities: GraphEntity[];
  relations: GraphRelation[];
  communities: Community[];
}

export class KnowledgeBase {
  papers = new Map<string, Paper>();
  chunks = new Map<string, Chunk>();
  entities = new Map<string, GraphEntity>();
  relations = new Map<string, GraphRelation>();
  communities: Community[] = [];
  bm25 = new BM25Index();

  private loaded = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await fs.readFile(KB_FILE, "utf-8");
      const snap = JSON.parse(raw) as KBSnapshot;
      for (const p of snap.papers ?? []) this.papers.set(p.id, p);
      for (const c of snap.chunks ?? []) {
        this.chunks.set(c.id, c);
        this.bm25.add(c.id, `${c.contextPrefix ?? ""}\n${c.rawText}`);
      }
      for (const e of snap.entities ?? []) this.entities.set(e.id, e);
      for (const r of snap.relations ?? []) this.relations.set(r.id, r);
      this.communities = snap.communities ?? [];
    } catch {
      // 首次运行无快照
    }
  }

  scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.saveNow(), 800);
  }

  async saveNow(): Promise<void> {
    try {
      await fs.mkdir(DATA_DIR, { recursive: true });
      const snap: KBSnapshot = {
        version: 1,
        papers: [...this.papers.values()],
        chunks: [...this.chunks.values()],
        entities: [...this.entities.values()],
        relations: [...this.relations.values()],
        communities: this.communities,
      };
      await fs.writeFile(KB_FILE, JSON.stringify(snap), "utf-8");
    } catch (err) {
      console.error("[kb] 持久化失败:", err);
    }
  }

  // ---------- 写入 ----------

  upsertPaper(paper: Paper): void {
    this.papers.set(paper.id, paper);
    this.scheduleSave();
  }

  addChunks(chunks: Chunk[]): void {
    for (const c of chunks) {
      this.chunks.set(c.id, c);
      this.bm25.add(c.id, `${c.contextPrefix ?? ""}\n${c.rawText}`);
    }
    this.scheduleSave();
  }

  removePaper(paperId: string): void {
    const chunkIds: string[] = [];
    for (const c of this.chunks.values()) if (c.paperId === paperId) chunkIds.push(c.id);
    for (const id of chunkIds) {
      this.chunks.delete(id);
      this.bm25.remove(id);
    }
    this.papers.delete(paperId);
    // 清理图谱中该文献的提及与证据
    for (const e of [...this.entities.values()]) {
      e.mentions = e.mentions.filter((m) => m.paperId !== paperId);
      if (e.mentions.length === 0) this.entities.delete(e.id);
    }
    for (const r of [...this.relations.values()]) {
      r.evidence = r.evidence.filter((ev) => ev.paperId !== paperId);
      if (r.evidence.length === 0) this.relations.delete(r.id);
    }
    this.scheduleSave();
  }

  replaceGraph(entities: GraphEntity[], relations: GraphRelation[], communities: Community[]): void {
    this.entities = new Map(entities.map((e) => [e.id, e]));
    this.relations = new Map(relations.map((r) => [r.id, r]));
    this.communities = communities;
    this.scheduleSave();
  }

  // ---------- 检索 ----------

  /** 暴力余弦向量检索（返回按余弦相似度降序） */
  vectorSearch(queryEmbedding: number[], topK: number, filterPaperIds?: Set<string>): Chunk[] {
    const scored: { chunk: Chunk; score: number }[] = [];
    for (const c of this.chunks.values()) {
      if (!c.embedding) continue;
      if (c.embedding.length !== queryEmbedding.length) continue; // 通道切换后的维度不匹配跳过
      if (filterPaperIds && !filterPaperIds.has(c.paperId)) continue;
      scored.push({ chunk: c, score: cosineSim(queryEmbedding, c.embedding) });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map((s) => s.chunk);
  }

  bm25Search(query: string, topK: number, filterPaperIds?: Set<string>): Chunk[] {
    const hits = this.bm25.search(query, topK * 3);
    const out: Chunk[] = [];
    for (const h of hits) {
      const c = this.chunks.get(h.id);
      if (!c) continue;
      if (filterPaperIds && !filterPaperIds.has(c.paperId)) continue;
      out.push(c);
      if (out.length >= topK) break;
    }
    return out;
  }

  // ---------- 统计 ----------

  stats() {
    const chunksWithEmbedding = [...this.chunks.values()].filter((c) => c.embedding).length;
    return {
      papers: this.papers.size,
      chunks: this.chunks.size,
      chunksWithEmbedding,
      entities: this.entities.size,
      relations: this.relations.size,
      communities: this.communities.length,
    };
  }
}

// Next.js dev 热重载安全单例
export function getKB(): KnowledgeBase {
  const g = globalThis as unknown as { __paperpilotKB?: KnowledgeBase };
  if (!g.__paperpilotKB) g.__paperpilotKB = new KnowledgeBase();
  return g.__paperpilotKB;
}
