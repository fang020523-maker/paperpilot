// 构建时复制 pdf.js worker 到 public/，保证浏览器端解析离线可用、无 CDN 依赖
import { copyFileSync, mkdirSync } from "fs";
import { createRequire } from "module";
import path from "path";

const require = createRequire(import.meta.url);
const src = path.dirname(require.resolve("pdfjs-dist/package.json"));
const target = path.join(process.cwd(), "public", "pdf.worker.min.mjs");
mkdirSync(path.dirname(target), { recursive: true });
copyFileSync(path.join(src, "build", "pdf.worker.min.mjs"), target);
console.log("[scripts] pdf.worker.min.mjs → public/");
