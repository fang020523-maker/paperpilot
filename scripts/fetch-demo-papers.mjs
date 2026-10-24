// 下载演示语料：RAG 领域 15 篇关键论文（正是本系统所实现技术的原始论文）
// 用法: npm run fetch:demo
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { spawnSync } from "child_process";
import path from "path";

const PAPERS = [
  { id: "2005.11401", name: "rag-lewis2020" }, // RAG 原始论文（Lewis et al.）
  { id: "2212.10496", name: "hyde" }, // HyDE 假设文档嵌入
  { id: "2310.11511", name: "self-rag" }, // Self-RAG 自反思
  { id: "2401.15884", name: "crag" }, // CRAG 纠错式检索
  { id: "2312.10997", name: "adaptive-rag" }, // Adaptive-RAG 复杂度路由
  { id: "2403.14403", name: "sufficient-context" }, // 拒答策略
  { id: "2307.03172", name: "lost-in-the-middle" }, // 上下文位置敏感性
  { id: "2309.15217", name: "ragas" }, // RAGAS 评估
  { id: "2404.16130", name: "graphrag" }, // Microsoft GraphRAG
  { id: "2410.05779", name: "lightrag" }, // LightRAG
  { id: "2402.18612", name: "raptor" }, // RAPTOR 层次摘要树
  { id: "2002.08011", name: "rag-survey" }, // RAG 综述（Gao et al.）
  { id: "1706.03762", name: "attention" }, // Attention Is All You Need
  { id: "2005.14165", name: "gpt3" }, // GPT-3
  { id: "2303.08774", name: "gpt4-report" }, // GPT-4 技术报告
];

const dir = path.join(process.cwd(), "demo-papers");
mkdirSync(dir, { recursive: true });

for (const p of PAPERS) {
  const dest = path.join(dir, `${p.name}-${p.id}.pdf`);
  if (existsSync(dest)) {
    console.log(`✓ ${p.name}`);
    continue;
  }
  console.log(`↓ ${p.name} (${p.id})`);
  const r = spawnSync(
    "curl",
    ["-fL", "--retry", "4", "--retry-delay", "3", "--connect-timeout", "20", "-o", dest, `https://arxiv.org/pdf/${p.id}`],
    { stdio: "ignore" }
  );
  if (r.status !== 0) {
    console.log(`  ✗ 失败: ${p.id}`);
    try {
      existsSync(dest) && require("fs").unlinkSync(dest);
    } catch {}
  }
}
console.log("[fetch-demo] 完成 → demo-papers/");
