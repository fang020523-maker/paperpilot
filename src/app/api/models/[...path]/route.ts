import { createReadStream, existsSync, statSync } from "fs";
import { Readable } from "stream";
import path from "path";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".json": "application/json",
  ".onnx": "application/octet-stream",
  ".txt": "text/plain",
};

/**
 * GET /api/models/[...path] — 端侧模型文件分发（同源供给浏览器 Transformers.js）
 * 仅允许访问 models/ 目录下的白名单文件，防路径穿越。
 */
const ALLOWED_ROOTS = ["e5-small"];
const ALLOWED_FILES = new Set([
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "special_tokens_map.json",
  "onnx/model_quantized.onnx",
]);

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await ctx.params;
  const root = parts[0];
  const relUnderRoot = parts.slice(1).join("/");
  if (!ALLOWED_ROOTS.includes(root) || !ALLOWED_FILES.has(relUnderRoot)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const abs = path.join(process.cwd(), "models", ...parts);
  if (!abs.startsWith(path.join(process.cwd(), "models")) || !existsSync(abs)) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  const stat = statSync(abs);
  const ext = path.extname(abs);
  const stream = Readable.toWeb(createReadStream(abs)) as ReadableStream;
  return new Response(stream, {
    headers: {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Content-Length": String(stat.size),
      "Cache-Control": "public, max-age=86400",
      "Accept-Ranges": "bytes",
    },
  });
}
