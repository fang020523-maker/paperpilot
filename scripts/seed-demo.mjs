// 一键种子演示知识库：解析 demo-papers/*.pdf 并导入运行中的 PaperPilot 服务
// 用法: 先启动 npm run dev，再运行 npm run seed:demo [-- --limit 5]
import { readdir, readFile } from "fs/promises";
import path from "path";

const BASE = process.env.SEED_BASE_URL ?? "http://localhost:3000";
const dir = path.join(process.cwd(), "demo-papers");
const limitIdx = process.argv.indexOf("--limit");
const limit = limitIdx > -1 ? Number(process.argv[limitIdx + 1]) : Infinity;

// pdf.js Node 端（legacy 构建自动使用 fake worker）
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

async function parsePdf(buf) {
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: true,
  }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let text = "";
    let lastY = null;
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 3) {
        text += Math.abs(y - lastY) > 14 ? "\n\n" : "\n";
      }
      text += item.str;
      if (item.hasEOL) text += "\n";
      lastY = y;
    }
    pages.push({ page: i, text: text.trim() });
  }
  return pages;
}

const files = (await readdir(dir)).filter((f) => f.endsWith(".pdf")).slice(0, limit);
console.log(`[seed] ${files.length} 篇论文 → ${BASE}`);

for (const f of files) {
  const buf = await readFile(path.join(dir, f));
  let pages;
  try {
    pages = await parsePdf(buf);
  } catch (err) {
    console.log(`✗ ${f}: PDF 解析失败 ${err.message}`);
    continue;
  }
  const res = await fetch(`${BASE}/api/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: f, pages }),
  });
  if (!res.ok || !res.body) {
    console.log(`✗ ${f}: HTTP ${res.status}`);
    continue;
  }
  // 读 SSE 直到 done/error
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf2 = "";
  let stage = "";
  outer: for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf2 += decoder.decode(value, { stream: true });
    const lines = buf2.split("\n\n");
    buf2 = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const evt = JSON.parse(line.slice(6));
      if (evt.type === "progress" && evt.stage !== stage) {
        stage = evt.stage;
        process.stdout.write(`  · ${evt.stage}\n`);
      }
      if (evt.type === "done") {
        console.log(`✓ ${evt.title.slice(0, 60)} — ${evt.chunks}块/${evt.entities}实体/${evt.relations}关系`);
        break outer;
      }
      if (evt.type === "error") {
        console.log(`✗ ${f}: ${evt.message}`);
        break outer;
      }
    }
  }
}
console.log("[seed] 完成。打开 http://localhost:3000/library 查看。");
