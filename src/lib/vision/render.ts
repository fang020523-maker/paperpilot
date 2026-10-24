"use client";

/**
 * 客户端将 PDF 页面渲染为图片（供 GLM-4V 图表理解）
 * 渲染发生在浏览器内 —— 与「PDF 原文不出浏览器」的隐私原则一致。
 */

export async function renderPdfPages(
  file: File,
  pages: number[],
  scale = 1.5,
  onPage?: (page: number) => void
): Promise<{ page: number; dataUrl: string }[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const out: { page: number; dataUrl: string }[] = [];
  for (const p of pages) {
    if (p > doc.numPages) continue;
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport }).promise;
    out.push({ page: p, dataUrl: canvas.toDataURL("image/jpeg", 0.72) });
    onPage?.(p);
  }
  return out;
}
