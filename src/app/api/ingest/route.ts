import { NextRequest } from "next/server";
import { ingestPaper } from "@/lib/kb/ingest";
import type { IngestEvent } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/ingest
 * Body: { filename: string; pages: { page: number; text: string }[] }
 * 返回 text/event-stream：实时推送导入管线各阶段进度
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    filename: string;
    pages: { page: number; text: string }[];
  };

  if (!body?.filename || !Array.isArray(body.pages) || body.pages.length === 0) {
    return Response.json({ error: "参数不完整：需要 filename 与非空 pages" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: IngestEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      };
      try {
        await ingestPaper(
          { filename: body.filename, pages: body.pages },
          (e) => send(e)
        );
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : "导入失败" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
