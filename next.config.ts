import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Transformers.js (ONNX Runtime) 必须保持在服务端外部包，避免 webpack 打包原生模块
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
