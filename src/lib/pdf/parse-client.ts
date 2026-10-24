"use client";

/**
 * 浏览器端 PDF 文本提取（pdf.js）
 * 在客户端完成解析 —— PDF 原文不出浏览器即可进入预览/校对，
 * 仅将提取文本送入服务端做增强与索引。
 */

export interface ParsedPdf {
  filename: string;
  pages: { page: number; text: string }[];
}

export async function parsePdf(
  file: File,
  onPage?: (page: number, total: number) => void
): Promise<ParsedPdf> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;

  const pages: { page: number; text: string }[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // 按 Y 坐标重建换行，尽量恢复段落结构
    let text = "";
    let lastY: number | null = null;
    let lastX: number | null = null;
    for (const item of content.items) {
      if (!("str" in item) || typeof item.str !== "string") continue;
      const y = item.transform[5];
      const x = item.transform[4];
      if (lastY !== null && Math.abs(y - lastY) > 3) {
        text += Math.abs(y - lastY) > 14 ? "\n\n" : "\n";
      } else if (lastX !== null && x - lastX > 60 && !/\s$/.test(text)) {
        text += " "; // 同行间距过大视为空格
      }
      text += item.str;
      if (item.hasEOL) text += "\n";
      lastY = y;
      lastX = x;
    }
    pages.push({ page: i, text: text.replace(/[ \t]+\n/g, "\n").trim() });
    onPage?.(i, doc.numPages);
  }
  return { filename: file.name, pages };
}
