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

## 2026-10 审计轮沉淀（新增约定）

- **多密钥轮换**：`ZHIPU_API_KEY` 支持逗号分隔多把 key，`nextZhipuKey()` 供直连 fetch（embeddings/vision）轮询
- **模型级回退**：`withFallback` 包装器 + 熔断器（连续 2 次失败 → 10 分钟冷却直走备模型）；fastModel=flash→4.6，chatModel=4.6→flash。同账号不同子模型配额路由可能不同（实测 flash 被锁而 4.6 可用）
- **NO_THINKING**：GLM-4.6/4.5 默认深度思考，所有 generate* 调用必须带 `providerOptions: NO_THINKING`（已实测生效）
- **LLM 输出 schema 必须宽松**：zod schema 不加 max/min/enum 硬约束（任何越界值整体校验失败），一律 nullable + 代码层 sanitizeExtraction/清洗/clamp；RAGAS 分数需 clamp（模型可能给 0-100 刻度）
- **批量种子**：`SKIP_EXTRACT=1`（写入 .env.local 并重启服务器才生效——种子脚本的环境变量传不到服务器进程）跳过 LLM 抽取走共现图谱；正式导入删掉该行
- **测试**：`npx vitest run`（21 项）；CI 在 .github/workflows/ci.yml（npm ci → vitest → build，构建零密钥可过）
- **浏览器录制坑**：IAB 录制中整页导航/页面刷新会取消录制或中断端侧同步——每页单独录、导航放录制间隙且用 SPA 内点击而非 goto
