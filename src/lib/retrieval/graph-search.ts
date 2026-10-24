/**
 * GraphRAG 双模式检索（M5 检索侧）
 *
 * - Local Search：种子实体（查询名匹配 + 语义块反查）→ 1 跳邻域扩展 → 证据句注入
 *   支撑多跳问题：「A 用了什么数据集 → 这些数据集还被谁用了」
 * - Global Search（Microsoft GraphRAG, arXiv:2404.16130）：社区摘要 map-rank
 *   支撑宏观问题：「这个领域的主要技术路线」
 */
import type { GraphContext, GraphEntity, GraphRelation, RetrievedChunk } from "../types";
import { getKB } from "../kb/store";
import { normalizeName } from "../kb/graph-extract";

/** 查询词直接匹配实体名/别名 + 语义检索结果反查实体，取并作为种子 */
export function findSeedEntities(query: string, retrieved?: RetrievedChunk[]): GraphEntity[] {
  const kb = getKB();
  const seeds = new Map<string, { entity: GraphEntity; score: number }>();

  // 1) 名称/别名直接匹配（去停用词后逐词 + 整串）
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/)
    .filter((t) => t.length > 1);
  for (const e of kb.entities.values()) {
    let s = 0;
    const nameLower = e.name.toLowerCase();
    if (terms.some((t) => nameLower.includes(t) && t.length > 2)) s += 3;
    for (const a of e.aliases) {
      const aLower = a.toLowerCase();
      if (terms.some((t) => aLower.includes(t) && t.length > 2)) s += 1;
    }
    if (s > 0) seeds.set(e.id, { entity: e, score: s });
  }

  // 2) 语义检索命中的 chunk → 提及其的实体
  if (retrieved) {
    const chunkScores = new Map(retrieved.map((r) => [r.chunk.id, r.score]));
    for (const e of kb.entities.values()) {
      let s = 0;
      for (const m of e.mentions) {
        for (const cid of m.chunkIds) {
          if (chunkScores.has(cid)) s += 1.5;
        }
      }
      if (s > 0) {
        const prev = seeds.get(e.id);
        seeds.set(e.id, { entity: e, score: (prev?.score ?? 0) + s });
      }
    }
  }

  return [...seeds.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((v) => v.entity);
}

/** Local Search：种子实体 1 跳邻域子图 + 证据句 */
export function graphLocalSearch(query: string, retrieved?: RetrievedChunk[]): GraphContext {
  const kb = getKB();
  const seeds = findSeedEntities(query, retrieved);
  if (seeds.length === 0) return { entities: [], relations: [], mode: "local" };

  const seedIds = new Set(seeds.map((s) => s.id));
  const relations: GraphRelation[] = [];
  const neighborIds = new Set<string>(seedIds);
  let hops = 0;
  for (const r of kb.relations.values()) {
    const touches = seedIds.has(r.sourceId) || seedIds.has(r.targetId);
    if (touches && relations.length < 24) {
      relations.push(r);
      neighborIds.add(r.sourceId);
      neighborIds.add(r.targetId);
      hops++;
    }
  }
  const entities = [...neighborIds]
    .map((id) => kb.entities.get(id))
    .filter((e): e is GraphEntity => !!e);
  return { entities, relations, mode: "local" };
}

/** Global Search：社区摘要按查询相关性排序（词面匹配 + 规模先验） */
export function graphGlobalSearch(query: string): GraphContext & { communities: NonNullable<GraphContext["communities"]> } {
  const kb = getKB();
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/)
    .filter((t) => t.length > 1);
  const communities = kb.communities
    .map((c) => {
      const memberNames = c.entityIds
        .map((id) => kb.entities.get(id)?.name ?? "")
        .filter(Boolean);
      const text = `${c.summary ?? ""} ${memberNames.join(" ")}`.toLowerCase();
      const overlap = terms.filter((t) => text.includes(t)).length;
      return { community: c, score: overlap * 2 + Math.min(c.size, 20) / 20 };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((v) => v.community);

  const entities = communities
    .flatMap((c) => c.entityIds.slice(0, 8))
    .map((id) => kb.entities.get(id))
    .filter((e): e is GraphEntity => !!e);
  return { entities, relations: [], mode: "global", communities };
}

/** 图谱上下文序列化为可注入 LLM 的文本 */
export function serializeGraphContext(ctx: GraphContext): string {
  if (ctx.mode === "global" && ctx.communities?.length) {
    const parts = ctx.communities.map(
      (c, i) => `[社区${i + 1}] ${c.summary ?? "（无摘要）"} 主要实体: ${c.entityIds
        .slice(0, 10)
        .map((id) => id)
        .join(", ")}`
    );
    return `以下是知识库主题社区的全局摘要（GraphRAG Global Search）：\n${parts.join("\n")}`;
  }
  if (ctx.entities.length === 0) return "";
  const entLines = ctx.entities
    .slice(0, 20)
    .map(
      (e) =>
        `- ${e.name} (${e.type}${e.communityId !== undefined ? `, 社区${e.communityId}` : ""}): ${e.mentions
          .map((m) => kbPaperTitle(m.paperId))
          .join("; ")}`
    );
  const relLines = ctx.relations
    .slice(0, 16)
    .map((r) => {
      const ev = r.evidence[0];
      return `- ${r.sourceId} —[${r.label}]→ ${r.targetId}${ev ? ` | 证据: “${ev.sentence.slice(0, 120)}”` : ""}`;
    });
  return `以下是知识图谱局部子图（GraphRAG Local Search）：\n实体:\n${entLines.join("\n")}\n关系:\n${relLines.join("\n")}`;
}

function kbPaperTitle(paperId: string): string {
  return getKB().papers.get(paperId)?.title.slice(0, 60) ?? paperId;
}
