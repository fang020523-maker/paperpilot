import { getKB } from "@/lib/kb/store";

export const dynamic = "force-dynamic";

/**
 * GET /api/chunks — 导出全部分块文本（供浏览器端侧嵌入构建本地向量库）
 * 不含服务端向量，仅文本与元数据。
 */
export async function GET() {
  const kb = getKB();
  await kb.ensureLoaded();
  const chunks = [...kb.chunks.values()].map((c) => ({
    id: c.id,
    paperId: c.paperId,
    paperTitle: kb.papers.get(c.paperId)?.title ?? "未知文献",
    page: c.page,
    section: c.section,
    text: c.text,
  }));
  return Response.json({ chunks, total: chunks.length });
}
