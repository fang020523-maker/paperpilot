"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose prose-sm prose-invert max-w-none prose-p:leading-relaxed prose-headings:mb-2 prose-headings:mt-4 prose-pre:bg-muted prose-pre:text-[12px] prose-code:text-primary prose-code:before:content-none prose-code:after:content-none prose-code:font-mono prose-code:text-[12.5px] prose-table:text-[12px] prose-th:px-2 prose-td:px-2 prose-li:my-0.5">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
