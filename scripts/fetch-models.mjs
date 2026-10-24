// 预下载端侧 Embedding 模型到本地 models/ 目录（curl 断点续传，国内走 hf-mirror）
// 用法: npm run fetch:models
import { existsSync, mkdirSync } from "fs";
import { spawnSync } from "child_process";
import path from "path";

const MIRROR = process.env.HF_ENDPOINT ?? "https://hf-mirror.com";
const FILES = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "special_tokens_map.json",
  "onnx/model_quantized.onnx",
];

const targetDir = path.join(process.cwd(), "models", "e5-small");

function fetch(url, dest) {
  mkdirSync(path.dirname(dest), { recursive: true });
  // -C - 断点续传；--retry 多次重试；--connect-timeout 快速失败
  const r = spawnSync(
    "curl",
    ["-fL", "--retry", "5", "--retry-delay", "2", "--connect-timeout", "15", "-C", "-", "-o", dest, url],
    { stdio: "inherit" }
  );
  if (r.status !== 0) throw new Error(`下载失败: ${url}`);
}

console.log(`[fetch-models] 目标目录: ${targetDir}`);
console.log(`[fetch-models] 镜像: ${MIRROR}`);
for (const f of FILES) {
  const dest = path.join(targetDir, f);
  if (existsSync(dest)) {
    console.log(`✓ 已存在 ${f}`);
    continue;
  }
  console.log(`↓ 下载 ${f} …`);
  fetch(`${MIRROR}/Xenova/multilingual-e5-small/resolve/main/${f}`, dest);
}
console.log("[fetch-models] 完成。运行时将直接使用本地模型（不联网）。");
