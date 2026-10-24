"use client";

/**
 * 浏览器端嵌入器（Transformers.js v3）
 * - 推理后端：WebGPU 优先，WASM 自动降级
 * - 模型来源：同源 public/models/e5-small（零外联，隐私模式不触网）
 */

type Pipe = (
  texts: string[],
  opts: { pooling: "mean"; normalize: boolean }
) => Promise<{ data: Float32Array; dims: number[] }>;

let pipePromise: Promise<{ pipe: Pipe; device: "webgpu" | "wasm" }> | null = null;

export function getBrowserEmbedder(): Promise<{ pipe: Pipe; device: "webgpu" | "wasm" }> {
  if (!pipePromise) {
    pipePromise = (async () => {
      const mod = await import("@huggingface/transformers");
      // 同源模型（/api/models/ 由服务端分发）+ 禁止远程回退
      mod.env.allowRemoteModels = false;
      mod.env.allowLocalModels = true;
      mod.env.localModelPath = "/api/models/";

      let device: "webgpu" | "wasm" = "wasm";
      let pipe: Pipe;
      try {
        if (typeof navigator !== "undefined" && "gpu" in navigator) {
          const adapter = await (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu?.requestAdapter();
          if (adapter) {
            pipe = (await mod.pipeline("feature-extraction", "e5-small", {
              dtype: "q8",
              device: "webgpu",
            })) as unknown as Pipe;
            // 试跑一次验证 WebGPU 真正可用
            await pipe(["query: 验证"], { pooling: "mean", normalize: true });
            device = "webgpu";
            return { pipe, device };
          }
        }
      } catch {
        // WebGPU 初始化或推理失败 → WASM 降级
      }
      pipe = (await mod.pipeline("feature-extraction", "e5-small", {
        dtype: "q8",
      })) as unknown as Pipe;
      return { pipe, device: "wasm" };
    })();
  }
  return pipePromise;
}

export async function embedInBrowser(
  texts: string[],
  kind: "query" | "passage"
): Promise<number[][]> {
  const { pipe } = await getBrowserEmbedder();
  const prefixed = texts.map((t) => `${kind}: ${t}`);
  const out = await pipe(prefixed, { pooling: "mean", normalize: true });
  const dim = out.dims[out.dims.length - 1];
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i++) {
    vectors.push(Array.from(out.data.slice(i * dim, (i + 1) * dim)));
  }
  return vectors;
}
