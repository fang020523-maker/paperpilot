import { getKB } from "@/lib/kb/store";

export const dynamic = "force-dynamic";

/**
 * GET /api/graph — 全量知识图谱（力导向可视化数据源）
 * 支持查询参数：minMentions（默认1）、limit（默认400 节点）
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const minMentions = Number(url.searchParams.get("minMentions") ?? 1);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 400), 800);

  const kb = getKB();
  await kb.ensureLoaded();

  // 取高提及实体，限制规模保证渲染流畅
  const entities = [...kb.entities.values()]
    .filter((e) => e.mentions.reduce((s, m) => s + m.count, 0) >= minMentions)
    .sort(
      (a, b) =>
        b.mentions.reduce((s, m) => s + m.count, 0) -
        a.mentions.reduce((s, m) => s + m.count, 0)
    )
    .slice(0, limit);
  const idSet = new Set(entities.map((e) => e.id));

  const links = [...kb.relations.values()]
    .filter((r) => idSet.has(r.sourceId) && idSet.has(r.targetId))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit * 3)
    .map((r) => ({
      source: r.sourceId,
      target: r.targetId,
      label: r.label,
      weight: r.weight,
      evidenceCount: r.evidence.length,
    }));

  const nodes = entities.map((e) => ({
    id: e.id,
    name: e.name,
    type: e.type,
    mentions: e.mentions.reduce((s, m) => s + m.count, 0),
    paperCount: e.mentions.length,
    aliases: e.aliases.slice(0, 3),
    communityId: e.communityId ?? null,
  }));

  return Response.json({
    nodes,
    links,
    communities: kb.communities.map((c) => ({
      id: c.id,
      size: c.size,
      summary: c.summary,
    })),
    stats: kb.stats(),
  });
}
