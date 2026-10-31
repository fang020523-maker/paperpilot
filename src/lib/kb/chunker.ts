/**
 * 结构感知分块（Structure-Aware Chunking）
 *
 * 学术 PDF 特点：双栏排版被逐行提取后语义断裂。策略：
 * 1. 行级重组：短行（<60% 中位行长）拼接，段落按空行/缩进切分
 * 2. 章节检测：正则识别编号标题（"3.2 Method"）/ 全大写标题 / 中文编号
 * 3. 动态窗口：目标 ~1100 字符（约 300 token），重叠 12%，避免割裂定义与公式
 * 4. 每块记录 {page, section}，供引用溯源定位
 */

export interface RawPage {
  page: number;
  text: string;
}

export interface RawChunk {
  index: number;
  page: number;
  section?: string;
  text: string;
}

const HEADING_PATTERNS = [
  /^(\d+\.)+(\d+)*\s+\S.{2,80}$/, // 1. / 3.2. Method
  /^([A-Z][A-Za-z0-9 ,\-&/()]{3,60})$/, // Title Case standalone line
  /^abstract\b/i,
  /^(abstract|references|acknowledgments?|appendix|introduction|conclusion[s]?|related work|experiments?|results?|discussion|method(s|ology)?|background|evaluation|conclusion and future work)\b/i,
  /^[一二三四五六七八九十]+[、.]\s*\S+/,
  /^第[一二三四五六七八九十\d]+[章节]\s*\S+/,
];

function looksLikeHeading(line: string, medianLen: number): boolean {
  const t = line.trim();
  if (t.length < 3 || t.length > 90) return false;
  if (/[.。;；]$/.test(t) && !/^\d/.test(t)) return false; // 句号结尾通常是正文
  return HEADING_PATTERNS.some((p) => p.test(t));
}

/** 从首页启发式抽取元数据（LLM 精修前的一级近似） */
export function heuristicMetadata(pages: RawPage[]) {
  const first = pages[0]?.text ?? "";
  const lines = first.split("\n").map((l) => l.trim()).filter(Boolean);
  // 标题：前几行中最长的行（排除许可声明/页眉噪声）
  const NOISE = /^(provided proper attribution|this paper|preprint|arxiv|draft|copyright|licensed|creative commons|google hereby|the paper {1,3})/i;
  let title = "";
  for (const l of lines.slice(0, 8)) {
    if (NOISE.test(l)) continue;
    if (l.length > title.length && l.length < 200 && !/^\d+$/.test(l)) title = l;
    if (title.length > 25) break;
  }
  // 全被噪声吞掉时兜底：取首个非噪声行
  if (!title) {
    title = lines.slice(0, 10).find((l) => !NOISE.test(l) && l.length > 10) ?? "未命名文献";
  }
  // 作者行：逗号/and 分隔的 Word 名字
  const authorLine = lines.find(
    (l) => /^[A-Z][a-z]+(( [A-Z]\.?)?( [A-Z][a-z]+)){0,2}(, ?[A-Z][a-z]+(( [A-Z]\.?)?( [A-Z][a-z]+)){0,2})+$/.test(l.replace(/ (and|&) /g, ", ")) && l.split(/,| and | & /).length >= 2
  );
  const authors = authorLine
    ? authorLine
        .replace(/ (and|&) /g, ", ")
        .split(",")
        .map((a) => a.trim())
        .filter((a) => a.length > 2 && a.length < 40)
    : [];
  // 年份：19xx/20xx
  const yearMatch = first.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? Number(yearMatch[0]) : undefined;
  // 摘要
  const absMatch = first.match(/abstract[:.\s]*([\s\S]{80,2000}?)(?=\n\s*\n|\b1\s+INTRODUCTION\b|\bIntroduction\b|\bI\.?\s+INTRODUCTION\b)/i);
  const abstract = absMatch ? absMatch[1].replace(/\s+/g, " ").trim().slice(0, 600) : undefined;
  // arXiv id
  const arxivMatch = first.match(/arxiv[:\s]*(\d{4}\.\d{4,5})(v\d+)?/i);

  return {
    title: title.replace(/\s+/g, " ").trim() || "未命名文献",
    authors,
    year,
    abstract,
    arxivId: arxivMatch?.[1],
  };
}

/** 重组 PDF 提取文本为自然段，然后结构化分块 */
export function chunkPages(pages: RawPage[], targetChars = 1100, overlapRatio = 0.12): RawChunk[] {
  const chunks: RawChunk[] = [];
  let currentSection: string | undefined;
  let buf: string[] = [];
  let bufLen = 0;
  let bufPage = 1;

  const flush = () => {
    const text = buf.join(" ").replace(/\s+/g, " ").trim();
    if (text.length >= 80) {
      chunks.push({ index: chunks.length, page: bufPage, section: currentSection, text });
    }
    // 保留重叠：取尾部片段开启下一块
    const overlap = text.slice(Math.floor(text.length * (1 - overlapRatio)));
    buf = overlap.length > 40 ? [overlap] : [];
    bufLen = buf.reduce((s, l) => s + l.length, 0);
  };

  for (const page of pages) {
    if (!page.text?.trim()) continue;
    const lines = page.text.split("\n").map((l) => l.replace(/\s+$/, ""));
    const lens = lines.map((l) => l.trim().length).filter((l) => l > 0).sort((a, b) => a - b);
    const medianLen = lens[Math.floor(lens.length / 2)] || 50;

    let para = "";
    const flushPara = () => {
      const t = para.trim();
      if (t.length > 0) {
        buf.push(t);
        bufLen += t.length;
        if (bufLen >= targetChars) flush();
      }
      para = "";
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        flushPara();
        continue;
      }
      if (looksLikeHeading(line, medianLen)) {
        flushPara();
        currentSection = line.slice(0, 80);
        continue;
      }
      // 连字符断词修复
      para += (para && !/[‐-]$/.test(para.trim()) ? " " : "") + line.replace(/‐$/, "");
      // 段落边界启发：行以句号结尾且足够长 → 可能段落结束；PDF 换行密度高时保守处理
      if (/[.。!?」)】]$/.test(line) && para.length > 400) flushPara();
    }
    flushPara();
    if (bufLen > 0 && bufLen >= targetChars * 0.6) flush(); // 跨页强制切分避免页码污染
    if (buf.length === 0) bufPage = page.page + 1;
  }
  // 收尾
  const text = buf.join(" ").replace(/\s+/g, " ").trim();
  if (text.length >= 80) {
    chunks.push({ index: chunks.length, page: bufPage, section: currentSection, text });
  }
  return chunks;
}

export function estimateTokens(text: string): number {
  // 中英混合粗估：ASCII ~4字符/token，CJK ~1.5字符/token
  let ascii = 0,
    cjk = 0;
  for (const ch of text) (ch.charCodeAt(0) > 127 ? cjk++ : ascii++);
  return Math.ceil(ascii / 4 + cjk / 1.5);
}
