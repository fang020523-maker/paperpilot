"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { parsePdf } from "@/lib/pdf/parse-client";
import type { IngestEvent } from "@/lib/types";

export interface FileJob {
  id: string;
  filename: string;
  status: "queued" | "parsing" | "ingesting" | "done" | "error";
  parseCurrent?: number;
  parseTotal?: number;
  stage?: string;
  stageDetail?: string;
  percent?: number;
  error?: string;
  result?: { paperId: string; title: string; chunks: number; entities: number; relations: number };
}

const STAGE_LABEL: Record<string, string> = {
  metadata: "抽取元数据",
  chunking: "结构化分块",
  "contextual-chunking": "上下文增强分块",
  embedding: "生成向量嵌入",
  "graph-extraction": "抽取实体关系",
  "community-summary": "重建主题社区",
};

export function useIngest(onFinished: () => void) {
  const [jobs, setJobs] = useState<FileJob[]>([]);
  const running = useRef(false);

  const patch = useCallback((id: string, p: Partial<FileJob>) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...p } : j)));
  }, []);

  const addFiles = useCallback(
    async (files: File[]) => {
      const pdfs = files.filter((f) => f.name.toLowerCase().endsWith(".pdf"));
      if (pdfs.length === 0) {
        toast.error("请上传 PDF 格式的论文文件");
        return;
      }
      const newJobs: FileJob[] = pdfs.map((f) => ({
        id: crypto.randomUUID(),
        filename: f.name,
        status: "queued",
      }));
      setJobs((prev) => [...newJobs, ...prev]);

      for (const job of newJobs) {
        try {
          // 阶段一：浏览器内解析
          patch(job.id, { status: "parsing", parseCurrent: 0 });
          const file = pdfs.find((f) => f.name === job.filename)!;
          const parsed = await parsePdf(file, (cur, total) =>
            patch(job.id, { parseCurrent: cur, parseTotal: total })
          );
          const textLen = parsed.pages.reduce((s, p) => s + p.text.length, 0);
          if (textLen < 300) {
            throw new Error("PDF 中未提取到足够文本（可能是扫描件）");
          }

          // 阶段二：服务端增强索引（SSE 进度）
          patch(job.id, { status: "ingesting", stage: "upload", stageDetail: "提交解析结果…", percent: 0 });
          const res = await fetch("/api/ingest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename: parsed.filename, pages: parsed.pages }),
          });
          if (!res.ok || !res.body) {
            const errText = await res.text().catch(() => "");
            throw new Error(`服务端处理失败: ${errText.slice(0, 120) || res.status}`);
          }
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split("\n\n");
            buf = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              let evt: IngestEvent;
              try {
                evt = JSON.parse(line.slice(6));
              } catch {
                continue;
              }
              if (evt.type === "progress") {
                patch(job.id, {
                  stage: STAGE_LABEL[evt.stage] ?? evt.stage,
                  stageDetail: evt.detail,
                  percent: Math.round((45 + evt.percent * 0.5) * 1), // 解析占50%，服务端管线占50%
                });
              } else if (evt.type === "done") {
                patch(job.id, {
                  status: "done",
                  percent: 100,
                  result: {
                    paperId: evt.paperId,
                    title: evt.title,
                    chunks: evt.chunks,
                    entities: evt.entities,
                    relations: evt.relations,
                  },
                });
                toast.success(`《${evt.title}》导入完成`, {
                  description: `${evt.chunks} 个分块 · ${evt.entities} 个实体 · ${evt.relations} 条关系`,
                });
                onFinished();
              } else if (evt.type === "error") {
                throw new Error(evt.message);
              }
            }
          }
          setJobs((prev) =>
            prev.map((j) =>
              j.id === job.id && j.status === "ingesting" ? { ...j, status: "error", error: "连接中断" } : j
            )
          );
        } catch (err) {
          patch(job.id, {
            status: "error",
            error: err instanceof Error ? err.message : "导入失败",
          });
          toast.error(`${job.filename} 导入失败`);
        }
      }
    },
    [patch, onFinished]
  );

  const clearFinished = useCallback(() => {
    setJobs((prev) => prev.filter((j) => j.status !== "done" && j.status !== "error"));
  }, []);

  return { jobs, addFiles, clearFinished };
}
