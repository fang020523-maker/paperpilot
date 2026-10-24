import { NextRequest } from "next/server";
import { getKB } from "@/lib/kb/store";

export const dynamic = "force-dynamic";

/** GET /api/papers/[id] — 文献详情（分块预览 + 关联实体） */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const kb = getKB();
  await kb.ensureLoaded();
  const paper = kb.papers.get(id);
  if (!paper) return Response.json({ error: "文献不存在" }, { status: 404 });

  const chunks = [...kb.chunks.values()]
    .filter((c) => c.paperId === id)
    .sort((a, b) => a.index - b.index)
    .slice(0, 12)
    .map((c) => ({ id: c.id, index: c.index, page: c.page, text: c.rawText.slice(0, 220) }));

  const entityNames = [...kb.entities.values()]
    .filter((e) => e.mentions.some((m) => m.paperId === id))
    .sort((a, b) => {
      const am = a.mentions.find((m) => m.paperId === id)?.count ?? 0;
      const bm = b.mentions.find((m) => m.paperId === id)?.count ?? 0;
      return bm - am;
    })
    .slice(0, 30)
    .map((e) => ({ name: e.name, type: e.type }));

  return Response.json({ paper, chunkPreview: chunks, entities: entityNames });
}

/** DELETE /api/papers/[id] — 删除文献及其全部索引 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const kb = getKB();
  await kb.ensureLoaded();
  if (!kb.papers.has(id)) return Response.json({ error: "文献不存在" }, { status: 404 });
  kb.removePaper(id);
  await kb.saveNow();
  return Response.json({ ok: true });
}
