"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FileText,
  Inbox,
  Loader2,
  Network,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useIngest } from "@/hooks/use-ingest";
import type { Paper } from "@/lib/types";
import { PaperDetailSheet } from "@/components/library/paper-detail-sheet";

interface PapersResponse {
  papers: Paper[];
  status: {
    primary: string;
    chatModel: string;
    embeddingMode: string;
    embeddingModeRaw: string;
  };
  stats: {
    papers: number;
    chunks: number;
    entities: number;
    relations: number;
    communities: number;
  };
}

export default function LibraryPage() {
  const [dragOver, setDragOver] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [visionOn, setVisionOn] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["papers"],
    queryFn: async (): Promise<PapersResponse> => {
      const res = await fetch("/api/papers");
      if (!res.ok) throw new Error("加载失败");
      return res.json();
    },
  });

  const { jobs, addFiles, clearFinished } = useIngest(() => void refetch());

  const papers = (data?.papers ?? []).filter(
    (p) =>
      !keyword ||
      p.title.toLowerCase().includes(keyword.toLowerCase()) ||
      p.authors.some((a) => a.toLowerCase().includes(keyword.toLowerCase()))
  );

  const deletePaper = async (id: string, title: string) => {
    const res = await fetch(`/api/papers/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success(`已删除《${title}》及其全部索引`);
      void refetch();
      // 图谱与知识库相关查询一并失效
      void queryClient.invalidateQueries({ queryKey: ["graph"] });
      void queryClient.invalidateQueries({ queryKey: ["papers"] });
    } else {
      toast.error("删除失败");
    }
  };

  return (
    <div className="flex-1 overflow-y-auto thin-scrollbar">
      <div className="mx-auto max-w-5xl px-6 py-8">
        {/* 页头 */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">文献库</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              上传 PDF 论文，自动完成分块、上下文增强、向量化与知识图谱构建
            </p>
          </div>
          {data && (
            <div className="flex gap-4 text-center">
              {[
                { icon: FileText, label: "文献", value: data.stats.papers },
                { icon: Database, label: "分块", value: data.stats.chunks },
                { icon: Network, label: "实体", value: data.stats.entities },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border bg-card/50 px-4 py-2">
                  <div className="flex items-center justify-center gap-1.5 text-lg font-semibold">
                    <s.icon className="size-4 text-primary" />
                    {s.value}
                  </div>
                  <div className="text-[11px] text-muted-foreground">{s.label}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 系统状态条 */}
        {data && (
          <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="gap-1 font-mono">
              LLM: {data.status.primary === "mock" ? "离线开发模式" : `${data.status.primary}/${data.status.chatModel}`}
            </Badge>
            <Badge variant="outline" className="gap-1 font-mono">
              Embedding: {data.status.embeddingMode === "cloud" ? "智谱 embedding-3" : "本地 ONNX e5-small (384d)"}
            </Badge>
            {data.status.primary === "mock" && (
              <span className="text-amber-500/90 flex items-center gap-1">
                <AlertTriangle className="size-3.5" />
                配置 .env.local 中的 ZHIPU_API_KEY 后重启，即可启用真实生成
              </span>
            )}
          </div>
        )}

        {/* 上传区 */}
        <div
          className={`mt-6 rounded-2xl border-2 border-dashed p-10 text-center transition-colors cursor-pointer ${
            dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
          }`}
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void addFiles(Array.from(e.dataTransfer.files), { vision: visionOn });
          }}
        >
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              void addFiles(Array.from(e.target.files ?? []), { vision: visionOn });
              e.target.value = "";
            }}
          />
          <Upload className="mx-auto size-8 text-primary/70" />
          <div className="mt-3 font-medium">拖拽论文 PDF 到此处，或点击选择文件</div>
          <div className="mt-1 text-xs text-muted-foreground">
            支持多文件批量导入 · PDF 在浏览器内解析 · 建议先用 3-10 篇论文体验
          </div>
          <label
            className="mt-3 inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground"
            onClick={(e) => e.stopPropagation()}
          >
            <Switch checked={visionOn} onCheckedChange={setVisionOn} />
            GLM-4V 图表理解（导入时解读图表页，需智谱密钥，较慢）
          </label>
        </div>

        {/* 导入任务 */}
        {jobs.length > 0 && (
          <div className="mt-6 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">导入任务</div>
              <Button variant="ghost" size="sm" onClick={clearFinished} className="h-7 text-xs">
                清除已完成
              </Button>
            </div>
            {jobs.map((job) => (
              <div key={job.id} className="rounded-xl border bg-card/60 p-4">
                <div className="flex items-center gap-3">
                  {job.status === "done" ? (
                    <CheckCircle2 className="size-4.5 shrink-0 text-emerald-500" />
                  ) : job.status === "error" ? (
                    <AlertTriangle className="size-4.5 shrink-0 text-destructive" />
                  ) : (
                    <Loader2 className="size-4.5 shrink-0 animate-spin text-primary" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {job.result?.title ?? job.filename}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {job.status === "queued" && "排队中…"}
                      {job.status === "parsing" &&
                        `浏览器内解析 PDF ${job.parseCurrent ?? 0}/${job.parseTotal ?? "?"} 页`}
                      {job.status === "ingesting" && `${job.stage ?? "处理中"} · ${job.stageDetail ?? ""}`}
                      {job.status === "done" &&
                        `完成：${job.result!.chunks} 分块 · ${job.result!.entities} 实体 · ${job.result!.relations} 关系`}
                      {job.status === "error" && job.error}
                    </div>
                  </div>
                  {job.status === "done" && (
                    <Badge variant="secondary" className="shrink-0 text-emerald-500">
                      可查询
                    </Badge>
                  )}
                </div>
                {(job.status === "parsing" || job.status === "ingesting") && (
                  <Progress
                    className="mt-3 h-1.5"
                    value={
                      job.status === "parsing"
                        ? ((job.parseCurrent ?? 0) / (job.parseTotal ?? 1)) * 50
                        : job.percent ?? 0
                    }
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {/* 文献列表 */}
        <div className="mt-10">
          <div className="mb-4 flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="搜索标题或作者…"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24 w-full rounded-xl" />
              ))}
            </div>
          ) : papers.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-14 text-center">
              <Inbox className="mx-auto size-8 text-muted-foreground/50" />
              <div className="mt-3 text-sm text-muted-foreground">
                {data?.papers.length ? "没有匹配的文献" : "文献库为空，上传第一篇论文开始构建知识库"}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {papers.map((p) => (
                <div
                  key={p.id}
                  className="group cursor-pointer rounded-xl border bg-card/60 p-4 transition-colors hover:border-primary/40"
                  onClick={() => setDetailId(p.id)}
                >
                  <div className="flex items-start gap-4">
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <FileText className="size-5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-1 font-medium">{p.title}</div>
                      <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                        {p.authors.slice(0, 4).join(", ") || "未知作者"}
                        {p.authors.length > 4 && ` 等 ${p.authors.length} 人`}
                        {p.year ? ` · ${p.year}` : ""}
                        {p.venue ? ` · ${p.venue}` : ""}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Badge variant="secondary" className="text-[10px]">
                          {p.pageCount} 页
                        </Badge>
                        <Badge variant="secondary" className="text-[10px]">
                          {p.chunkCount} 分块
                        </Badge>
                        {p.arxivId && (
                          <Badge variant="outline" className="text-[10px] font-mono">
                            arXiv:{p.arxivId}
                          </Badge>
                        )}
                        {p.status !== "ready" && (
                          <Badge variant="outline" className="text-[10px] text-amber-500">
                            {p.status === "processing" ? "处理中" : "异常"}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        void deletePaper(p.id, p.title);
                      }}
                    >
                      <Trash2 className="size-4 text-muted-foreground hover:text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <PaperDetailSheet paperId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
