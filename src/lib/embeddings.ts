/**
 * Embedding 双通道
 *
 * - cloud: 智谱 embedding-3（1024 维），批量并发，走 OpenAI 兼容 /embeddings
 * - local: Transformers.js + ONNX（Xenova/multilingual-e5-small，384 维，量化 q8）
 *   服务端（Node）与浏览器端共用同一模型 —— 隐私模式下文献完全不出浏览器
 *
 * E5 模型要求前缀：检索文本 "passage: " / 查询 "query: "
 */
import { zhipuKey, ZHIPU_EMBEDDING_MODEL } from "./llm";

export type EmbeddingSource = "cloud" | "local";
export interface EmbeddingChannel {
  source: EmbeddingSource;
  dim: number;
  embed(texts: string[], kind?: "query" | "passage"): Promise<number[][]>;
}

// ---------- 云端通道 ----------
const ZHIPU_BASE = "https://open.bigmodel.cn/api/paas/v4";

async function cloudEmbed(texts: string[]): Promise<number[][]> {
  const key = zhipuKey();
  if (!key) throw new Error("ZHIPU_API_KEY missing");
  const out: number[][] = [];
  const BATCH = 16; // 智谱单批上限
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const res = await fetch(`${ZHIPU_BASE}/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: ZHIPU_EMBEDDING_MODEL, input: batch, dimensions: 1024 }),
    });
    if (!res.ok) {
      throw new Error(`智谱 embedding 失败 ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const json = (await res.json()) as { data: { embedding: number[]; index: number }[] };
    batch.forEach((_, j) => out[i + j] = json.data[j].embedding);
  }
  return out;
}

// ---------- 本地通道（Transformers.js / ONNX，Node 与浏览器通用）----------
type Extractor = (
  texts: string[],
  opts: { pooling: "mean"; normalize: boolean }
) => Promise<{ data: Float32Array; dims: number[] }>;

let localExtractor: Extractor | null = null;
let localLoading: Promise<Extractor> | null = null;

async function loadLocalExtractor(): Promise<Extractor> {
  if (localExtractor) return localExtractor;
  if (!localLoading) {
    localLoading = (async () => {
      // 动态 import：服务端在 Node 加载 onnxruntime-node，浏览器加载 WASM/WebGPU
      const mod = await import("@huggingface/transformers");
      const { existsSync } = await import("fs");
      const path = await import("path");
      // 优先使用 scripts/fetch-models.mjs 预下载的本地模型（离线可用、启动快）
      const localDir = path.join(process.cwd(), "models");
      if (existsSync(path.join(localDir, "e5-small", "onnx", "model_quantized.onnx"))) {
        mod.env.allowRemoteModels = false;
        mod.env.localModelPath = localDir;
        const pipe = await mod.pipeline("feature-extraction", "e5-small", { dtype: "q8" });
        localExtractor = pipe as unknown as Extractor;
        return localExtractor;
      }
      // 无本地模型 → 远程下载，国内默认走 HF 镜像（可通过 HF_ENDPOINT 覆盖）
      mod.env.remoteHost = process.env.HF_ENDPOINT ?? "https://hf-mirror.com";
      const pipe = await mod.pipeline("feature-extraction", "Xenova/multilingual-e5-small", {
        dtype: "q8",
      });
      localExtractor = pipe as unknown as Extractor;
      return localExtractor;
    })();
  }
  return localLoading;
}

async function localEmbed(texts: string[], kind: "query" | "passage"): Promise<number[][]> {
  const extractor = await loadLocalExtractor();
  const prefixed = texts.map((t) => `${kind}: ${t}`);
  const out = await extractor(prefixed, { pooling: "mean", normalize: true });
  const dim = out.dims[out.dims.length - 1];
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i++) {
    vectors.push(Array.from(out.data.slice(i * dim, (i + 1) * dim)).map((v) => Number(v.toFixed(5))));
  }
  return vectors;
}

// ---------- 通道选择 ----------
let cachedChannel: EmbeddingChannel | null = null;

export async function getEmbeddingChannel(): Promise<EmbeddingChannel> {
  if (cachedChannel) return cachedChannel;
  const mode = (process.env.EMBEDDING_MODE ?? "auto").toLowerCase();
  if (mode === "cloud" && zhipuKey()) {
    cachedChannel = { source: "cloud", dim: 1024, embed: (t) => cloudEmbed(t) };
    return cachedChannel;
  }
  if (mode === "local" || !zhipuKey()) {
    cachedChannel = {
      source: "local",
      dim: 384,
      embed: (t, kind = "passage") => localEmbed(t, kind),
    };
    return cachedChannel;
  }
  cachedChannel = { source: "cloud", dim: 1024, embed: (t) => cloudEmbed(t) };
  return cachedChannel;
}

// ---------- 向量工具 ----------
export function cosineSim(a: number[], b: number[]): number {
  let dot = 0,
    na = 0,
    nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-10);
}
