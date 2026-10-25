<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/docs/`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## PaperPilot 项目约定

**架构**：四层（前端 / Agentic 工具 / 检索 / LLM 接入）。后端刻意轻薄——仅 API Routes，无外部数据库（内存索引 + `.data/knowledge-base.json` 快照，见 `src/lib/kb/store.ts` 的 globalThis 单例）。

**关键模块**：
- `src/lib/agents/tools.ts` — 五工具状态机（classify/hybrid_retrieve/grade_documents/graph_search/self_assess），chat 流式与 benchmark 批量共用，勿在 route 内复制粘贴工具定义
- `src/lib/retrieval/` — 自研 BM25（中英混合分词）、混合检索 RRF、图谱检索
- `src/lib/kb/` — 分块、图谱抽取、共现降级、导入编排
- `src/lib/llm.ts` — 智谱(主)/DeepSeek(备)/mock(离线) 三级降级，`fastModel()` 用于打分/重写等轻任务

**降级链（必须保持）**：任何 LLM 依赖失败都不应阻塞主流程——上下文增强失败→章节前缀；实体抽取失败→术语共现图谱；云端嵌入失败→本地 ONNX；WebGPU→WASM。

**验证**：改完跑 `npm run build`（含 TS 类型检查）；功能验证用 `npm run dev` + `npm run seed:demo`（15 篇 arXiv 论文，需 dev 运行中）。无密钥时为 mock 模式，仅能验证管线结构与 UI，生成质量需真实 `ZHIPU_API_KEY`。

**样式**：Tailwind v4 + shadcn/ui（radix-nova），主题变量在 `src/app/globals.css`（学术深空 OKLCH 配色，dark 为默认且唯一调校过的模式）。
