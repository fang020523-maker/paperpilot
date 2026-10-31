// 黄金测试集检索回归：MCP search_papers 走真实混合检索管线（查询扩展+BM25+向量+RRF+LLM重排）
// 用法：node scripts/eval-golden.mjs [--top 5] [--base 3000]
import { readFileSync } from "fs";
import path from "path";

const BASE = (() => {
  const i = process.argv.indexOf("--base");
  return `http://localhost:${i > -1 ? process.argv[i + 1] : 3000}`;
})();
const TOPK = (() => {
  const i = process.argv.indexOf("--top");
  return i > -1 ? Number(process.argv[i + 1]) : null;
})();

const spec = JSON.parse(
  readFileSync(path.join(process.cwd(), "docs", "golden-testset.json"), "utf-8")
);
const topK = TOPK ?? spec.topK ?? 5;

async function search(query, topK) {
  const res = await fetch(`${BASE}/api/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "search_papers", arguments: { query, topK } },
    }),
    signal: AbortSignal.timeout(180000),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message);
  const text = j.result.content[0].text;
  return JSON.parse(text).results ?? [];
}

let hits = 0;
const misses = [];
for (const [i, c] of spec.cases.entries()) {
  try {
    const results = await search(c.q, topK);
    const titles = results.map((r) => r.paper ?? "");
    const hit = titles.some((t) => c.expect.some((k) => t.includes(k)));
    if (hit) hits++;
    else misses.push({ q: c.q, expect: c.expect, got: titles.slice(0, 3) });
    console.log(
      `${hit ? "✓" : "✗"} [${i + 1}/${spec.cases.length}] ${c.q}  →  ${titles[0]?.slice(0, 50) ?? "(空)"}`
    );
  } catch (e) {
    misses.push({ q: c.q, error: String(e.message).slice(0, 80) });
    console.log(`✗ [${i + 1}] ERROR ${e.message.slice(0, 60)}`);
  }
}
const rate = Math.round((hits / spec.cases.length) * 100);
console.log(`\n命中率: ${hits}/${spec.cases.length} = ${rate}% (top-${topK}, 门槛 80%)`);
if (misses.length) {
  console.log("\n未命中明细:");
  for (const m of misses) console.log(`  - ${m.q} | 期望含 ${m.expect.join("/")} | 实得 ${JSON.stringify(m.got ?? m.error)}`);
}
process.exit(rate >= 80 ? 0 : 1);
