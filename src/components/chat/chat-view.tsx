"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import {
  ArrowUp,
  BookOpenText,
  ChevronsDownUp,
  Cpu,
  FileText,
  FlaskConical,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Square,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Markdown } from "@/components/chat/markdown";
import { PipelineTimeline, type StepPart } from "@/components/chat/pipeline-timeline";
import { SpeakButton, VoiceInput } from "@/components/chat/voice";
import { useEvalStore } from "@/stores/eval-history";
import { useLocalKb } from "@/hooks/use-local-kb";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { cn } from "@/lib/utils";

type Pipeline = "agentic" | "naive" | "privacy";

const SUGGESTIONS = [
  "Self-RAG 通过什么机制控制检索时机？",
  "哪些论文用了 HotpotQA 数据集做评测？",
  "知识库中的论文覆盖了哪些主要技术路线？",
  "CRAG 和 Self-RAG 在纠错策略上有何不同？",
];

/** 从消息 parts 提取：时间线步骤 / 引用 / 上下文文本 */
interface CitationChip {
  no: number;
  paperTitle: string;
  page: number;
  section?: string;
  score: number;
  text: string;
}

function parseParts(message: UIMessage) {
  const steps: StepPart[] = [];
  let citations: CitationChip[] = [];
  let contexts: string[] = [];
  let answerText = "";
  for (const part of message.parts ?? []) {
    if (part.type === "text") answerText += part.text;
    if (part.type === "tool-invocation") {
      const inv = part.toolInvocation;
      steps.push({
        toolName: inv.toolName,
        state: inv.state,
        args: inv.args,
        result: "result" in inv ? inv.result : undefined,
      });
      if (inv.toolName === "hybrid_retrieve" && inv.state === "result") {
        const res = inv.result as {
          candidates?: { no: number; paperTitle: string; page: number; section?: string; score: number; text: string }[];
        };
        if (res.candidates?.length) {
          citations = res.candidates.map((c) => ({
            no: c.no,
            paperTitle: c.paperTitle,
            page: c.page,
            section: c.section,
            score: c.score,
            text: c.text,
          }));
          contexts = res.candidates.map((c) => c.text);
        }
      }
    }
  }
  return { steps, citations, contexts, answerText };
}

function RagasBar({ scores }: { scores: { faithfulness: number; answerRelevancy: number; contextPrecision: number; contextRecall: number } }) {
  const items = [
    { label: "忠实", v: scores.faithfulness },
    { label: "相关", v: scores.answerRelevancy },
    { label: "精确", v: scores.contextPrecision },
    { label: "召回", v: scores.contextRecall },
  ];
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-primary/15 bg-primary/[0.04] px-3 py-2">
      <span className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
        <FlaskConical className="size-3" /> RAGAS
      </span>
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1 text-[11px]">
          <span className="text-muted-foreground">{it.label}</span>
          <span
            className={cn(
              "font-mono font-medium",
              it.v >= 0.75 ? "text-emerald-500" : it.v >= 0.5 ? "text-amber-500" : "text-destructive"
            )}
          >
            {it.v.toFixed(2)}
          </span>
        </span>
      ))}
    </div>
  );
}

export function ChatView() {
  const [pipeline, setPipeline] = useState<Pipeline>("agentic");
  const [input, setInput] = useState("");
  const [showTimeline, setShowTimeline] = useState(true);
  const [ragas, setRagas] = useState<Record<string, Record<string, number>>>({});
  const [evaluating, setEvaluating] = useState<Record<string, boolean>>({});
  const [activeCitation, setActiveCitation] = useState<CitationChip | null>(null);
  const privacyQuestions = useRef<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);
  const addRecord = useEvalStore((s) => s.addRecord);
  const localKb = useLocalKb();

  // 开启隐私模式 → 同步端侧向量库（浏览器内 WebGPU/WASM 嵌入）
  useEffect(() => {
    if (pipeline === "privacy") void localKb.ensureSynced();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipeline]);

  const { messages, append, isLoading, stop, setMessages, error } = useChat({
    api: "/api/chat",
    body: { pipeline: pipeline === "privacy" ? "privacy" : pipeline },
  });

  // 知识库状态（空库时给出导入引导）
  const { data: kbInfo } = useQuery({
    queryKey: ["papers"],
    queryFn: async () => {
      const res = await fetch("/api/papers");
      return res.json() as Promise<{ papers: unknown[]; stats: { papers: number; chunks: number } }>;
    },
    staleTime: 30_000,
  });
  const kbEmpty = kbInfo !== undefined && kbInfo.stats.papers === 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  // 回答完成后自动触发 RAGAS 评估
  useEffect(() => {
    if (isLoading) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return;
    const { answerText, contexts, steps } = parseParts(last);
    if (!answerText.trim() || ragas[last.id] || evaluating[last.id]) return;
    const question = [...messages].reverse().find((m) => m.role === "user");
    const qText =
      question?.parts?.find((p) => p.type === "text")?.text ?? "未知问题";

    setEvaluating((e) => ({ ...e, [last.id]: true }));
    fetch("/api/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: qText,
        answer: answerText,
        contexts,
        pipeline: pipeline === "naive" ? "naive" : "agentic",
        methods: steps.map((s) => s.toolName),
      }),
    })
      .then((r) => r.json())
      .then((scores) => {
        if (scores.error) throw new Error(scores.error);
        setRagas((prev) => ({ ...prev, [last.id]: scores }));
        addRecord({
          id: crypto.randomUUID(),
          question: qText,
          answerPreview: answerText.slice(0, 160),
          scores: {
            faithfulness: scores.faithfulness,
            answerRelevancy: scores.answerRelevancy,
            contextPrecision: scores.contextPrecision,
            contextRecall: scores.contextRecall,
            latencyMs: scores.latencyMs ?? 0,
            methods: steps.map((s) => s.toolName),
          },
          pipeline: pipeline === "naive" ? "naive" : "agentic",
          createdAt: new Date().toISOString(),
        });
      })
      .catch(() => toast.warning("RAGAS 评估未完成（不影响回答）"))
      .finally(() => setEvaluating((e) => ({ ...e, [last.id]: false })));
  }, [isLoading, messages, pipeline, ragas, evaluating, addRecord]);

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || isLoading) return;
    setInput("");

    if (pipeline === "privacy") {
      // 端侧检索：浏览器内嵌入 + IndexedDB 向量库，仅命中片段上云
      let hits: Awaited<ReturnType<typeof localKb.searchLocally>> = [];
      try {
        const ok = await localKb.ensureSynced();
        if (ok) hits = await localKb.searchLocally(t, 5);
      } catch {
        toast.error("端侧检索失败，请检查浏览器兼容性");
        return;
      }
      if (hits.length === 0) {
        toast.warning("本地向量库为空：请先导入文献并等待端侧同步完成");
        return;
      }
      privacyQuestions.current.add(t);
      void append(
        { role: "user", content: t },
        {
          body: {
            pipeline: "privacy",
            contexts: hits.map((h) => ({
              paperTitle: h.chunk.paperTitle,
              page: h.chunk.page,
              text: h.chunk.text,
            })),
          },
        }
      );
      return;
    }

    void append({ role: "user", content: t });
  };

  const hasMessages = messages.length > 0;
  const lastMessage = messages[messages.length - 1];

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* 顶栏 */}
      <header className="flex items-center gap-3 border-b px-5 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <BookOpenText className="size-4.5 text-primary shrink-0" />
          <h1 className="truncate text-sm font-semibold">智能问答</h1>
          <span className="hidden truncate text-xs text-muted-foreground md:inline">
            {pipeline === "agentic"
              ? "Agentic RAG：自适应路由 · 纠错检索 · 自反思 · 图谱推理"
              : "朴素 RAG 基线：单轮向量检索（A/B 对照）"}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {/* 管线切换：Agentic / 基线 / 端侧隐私 */}
          <div className="flex rounded-lg border p-0.5 text-[11px]">
            <button
              className={cn(
                "flex items-center gap-1 rounded-md px-2.5 py-1 transition-colors",
                pipeline === "agentic" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
              )}
              onClick={() => setPipeline("agentic")}
            >
              <Zap className="size-3" /> Agentic
            </button>
            <button
              className={cn(
                "flex items-center gap-1 rounded-md px-2.5 py-1 transition-colors",
                pipeline === "naive" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
              )}
              onClick={() => setPipeline("naive")}
            >
              <FlaskConical className="size-3" /> 基线
            </button>
            <button
              className={cn(
                "flex items-center gap-1 rounded-md px-2.5 py-1 transition-colors",
                pipeline === "privacy"
                  ? "bg-emerald-600 text-white"
                  : "text-muted-foreground"
              )}
              onClick={() => setPipeline("privacy")}
              title="端侧隐私模式：嵌入与检索在浏览器完成，仅命中片段上云生成"
            >
              <ShieldCheck className="size-3" /> 隐私
            </button>
          </div>
          {pipeline === "privacy" && (
            <Badge variant="outline" className="gap-1 border-emerald-600/40 font-mono text-[9px] text-emerald-500">
              <Cpu className="size-3" />
              {localKb.status === "syncing"
                ? `端侧嵌入 ${localKb.progress}%`
                : localKb.status === "ready"
                  ? `${localKb.device === "webgpu" ? "WebGPU" : "WASM"} · ${localKb.chunkCount} 片段`
                  : localKb.status === "error"
                    ? "端侧同步失败"
                    : "待同步"}
            </Badge>
          )}
          {hasMessages && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                title={showTimeline ? "折叠检索时间线" : "展开检索时间线"}
                onClick={() => setShowTimeline((v) => !v)}
              >
                <ChevronsDownUp className={cn("size-4", !showTimeline && "opacity-50")} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                title="清空对话"
                onClick={() => {
                  setMessages([]);
                  setRagas({});
                }}
              >
                <RotateCcw className="size-4" />
              </Button>
            </>
          )}
        </div>
      </header>

      {/* 消息区 */}
      <div className="flex-1 overflow-y-auto thin-scrollbar">
        <div className="mx-auto max-w-3xl px-5 py-6 space-y-8">
          {kbEmpty && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
              <BookOpenText className="size-4 shrink-0 text-amber-500" />
              <span className="flex-1 text-amber-200/90">
                知识库为空——先导入论文，问答能力将随知识库解锁
              </span>
              <Button asChild size="sm" variant="outline" className="h-7 border-amber-500/40 text-amber-200 hover:text-amber-100">
                <Link href="/library">前往文献库导入</Link>
              </Button>
            </div>
          )}
          {!hasMessages && (
            <div className="pt-[8vh] text-center">
              <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10">
                <BookOpenText className="size-7 text-primary" />
              </div>
              <h2 className="mt-4 text-2xl font-semibold tracking-tight">
                向你的<span className="text-gradient-brand">文献知识库</span>提问
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                每次回答都会展示完整的检索推理时间线，论断带 [n] 引用可溯源，并自动进行 RAGAS 质量评估
              </p>
              <div className="mx-auto mt-8 grid max-w-xl gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-xl border bg-card/40 px-4 py-3 text-left text-sm text-foreground/85 transition-colors hover:border-primary/40 hover:bg-card/70 hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => {
            if (m.role === "user") {
              const text = m.parts?.find((p) => p.type === "text")?.text ?? "";
              const isPrivacy = privacyQuestions.current.has(text);
              return (
                <div key={m.id} className="space-y-1.5">
                  <div className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground leading-relaxed whitespace-pre-wrap">
                      {text}
                    </div>
                  </div>
                  {isPrivacy && (
                    <div className="flex justify-end">
                      <span className="flex items-center gap-1.5 rounded-full border border-emerald-600/30 bg-emerald-600/10 px-2.5 py-0.5 text-[10px] text-emerald-500">
                        <ShieldCheck className="size-3" />
                        端侧检索完成：浏览器 {localKb.device === "webgpu" ? "WebGPU" : "WASM"} 嵌入 · 仅命中片段参与生成
                      </span>
                    </div>
                  )}
                </div>
              );
            }
            const { steps, citations, answerText } = parseParts(m);
            const isLast = m.id === lastMessage?.id;
            const streaming = isLast && isLoading;
            return (
              <div key={m.id} className="space-y-3">
                {showTimeline && steps.length > 0 && (
                  <div className="rounded-xl border bg-card/40 px-4 py-3.5">
                    <PipelineTimeline steps={steps} />
                  </div>
                )}
                {(answerText || !streaming) && (
                  <div className="rounded-2xl rounded-tl-md border bg-card/70 px-5 py-4">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="flex size-5 items-center justify-center rounded-md bg-primary/15">
                          <BookOpenText className="size-3 text-primary" />
                        </span>
                        PaperPilot
                        {streaming && <Loader2 className="size-3 animate-spin" />}
                      </div>
                      {answerText && !streaming && <SpeakButton text={answerText} />}
                    </div>
                    {answerText ? (
                      <div className={cn(streaming && "[&>div>*:last-child]:after:content-['▍']")}>
                        <Markdown>{answerText}</Markdown>
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">（无文本回答——查看上方时间线）</div>
                    )}

                    {citations.length > 0 && (
                      <div className="mt-4 border-t pt-3">
                        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          引用来源（点击查看原文证据）
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {citations.map((c) => (
                            <button
                              key={c.no}
                              onClick={() => setActiveCitation(c)}
                              title={`${c.paperTitle} 第${c.page}页 · 相关度 ${c.score}（点击查看原文片段）`}
                              className="citation-chip flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] transition-opacity hover:opacity-80"
                            >
                              <span className="font-mono">[{c.no}]</span>
                              <FileText className="size-3" />
                              <span className="max-w-48 truncate">{c.paperTitle}</span>
                              <span className="opacity-70 font-mono">P{c.page}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {evaluating[m.id] && (
                      <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <Loader2 className="size-3 animate-spin" /> RAGAS 评估中…
                      </div>
                    )}
                    {ragas[m.id] && <RagasBar scores={ragas[m.id] as never} />}
                  </div>
                )}
              </div>
            );
          })}

          {error && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              请求失败：{error.message}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* 输入区 */}
      <div className="border-t px-5 py-4">
        <div className="mx-auto max-w-3xl">
          <div className="relative rounded-2xl border bg-card/60 focus-within:border-primary/50">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder={
                pipeline === "agentic"
                  ? "提问，如：哪些工作用了相同的数据集？表现如何？"
                  : pipeline === "privacy"
                    ? "隐私模式：检索在浏览器完成，仅命中片段上云"
                    : "基线模式：单轮向量检索问答（用于 A/B 对比）"
              }
              autoFocus
              className="max-h-44 min-h-[52px] resize-none border-0 bg-transparent px-4 py-3.5 pr-24 text-sm focus-visible:ring-0"
              rows={1}
            />
            <div className="absolute bottom-2.5 right-2.5 flex items-center gap-1.5">
              <VoiceInput onTranscript={(t) => setInput((prev) => (prev ? `${prev} ${t}` : t))} />
              {isLoading ? (
                <Button size="icon" className="size-8 rounded-xl" onClick={() => stop()} title="停止生成">
                  <Square className="size-3.5" />
                </Button>
              ) : (
                <Button
                  size="icon"
                  className="size-8 rounded-xl"
                  disabled={!input.trim()}
                  onClick={() => void send(input)}
                  title="发送 (Enter)"
                >
                  <ArrowUp className="size-4" />
                </Button>
              )}
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between px-1 text-[10px] text-muted-foreground/90">
            <span>Enter 发送 · Shift+Enter 换行 · 回答由 AI 生成并附引用，请核对原文</span>
            <Badge variant="outline" className="font-mono text-[9px]">
              {pipeline === "agentic" ? "Adaptive + CRAG + Self-RAG" : pipeline === "privacy" ? "On-Device RAG" : "Naive RAG"}
            </Badge>
          </div>
        </div>
      </div>

      {/* 引用溯源对话框 */}
      <Dialog open={!!activeCitation} onOpenChange={(open) => !open && setActiveCitation(null)}>
        <DialogContent className="sm:max-w-2xl">
          {activeCitation && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2.5 text-left text-base leading-snug">
                  <span className="citation-chip flex size-6 shrink-0 items-center justify-center rounded-md font-mono text-xs">
                    {activeCitation.no}
                  </span>
                  <span className="line-clamp-2">{activeCitation.paperTitle}</span>
                </DialogTitle>
                <div className="flex flex-wrap items-center gap-1.5 pt-1 text-left">
                  <Badge variant="secondary" className="text-[10px]">第 {activeCitation.page} 页</Badge>
                  {activeCitation.section && (
                    <Badge variant="secondary" className="max-w-72 truncate text-[10px]">
                      {activeCitation.section}
                    </Badge>
                  )}
                  <Badge variant="outline" className="font-mono text-[10px]">
                    相关度 {activeCitation.score}
                  </Badge>
                </div>
              </DialogHeader>
              <div className="max-h-[55vh] overflow-y-auto thin-scrollbar rounded-xl border bg-muted/20 p-4">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  原文片段（含上下文增强前缀）
                </div>
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90">
                  {activeCitation.text}
                </p>
              </div>
              <p className="text-[11px] text-muted-foreground">
                该片段由混合检索召回并经 LLM 重排序，引用请以论文原文为准。
              </p>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
