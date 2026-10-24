import { getKB } from "@/lib/kb/store";
import { llmStatus } from "@/lib/llm";

export const dynamic = "force-dynamic";

/** GET /api/papers — 文献列表 + 系统状态 */
export async function GET() {
  const kb = getKB();
  await kb.ensureLoaded();
  const papers = [...kb.papers.values()].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt)
  );
  return Response.json({ papers, status: llmStatus(), stats: kb.stats() });
}
