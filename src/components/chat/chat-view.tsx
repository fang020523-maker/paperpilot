"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import {
  ArrowUp,
  BookOpenText,
  ChevronsDownUp,
  FileText,
  FlaskConical,
  Loader2,
  RotateCcw,
  Square,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Markdown } from "@/components/chat/markdown";
import { PipelineTimeline, type StepPart } from "@/components/chat/pipeline-timeline";
import { useEvalStore } from "@/stores/eval-history";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "Self-RAG 通过什么机制控制检索时机？",
  "哪些论文用了 HotpotQA 数据集做评测？",
  "知识库中的论文覆盖了哪些主要技术路线？",
  "CRAG 和 Self-RAG 在纠错策略上有何不同？",
];

/** 从消息 parts 提取：时间线步骤 / 引用 / 上下文文本 */
function parseParts(message: UIMessage) {
  const steps: StepPart[] = [];
  let citations: { no: number; paperTitle: string; page: number; score: number }[] = [];
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
          candidates?: { no: number; paperTitle: string; page: number; score: number; text: string }[];
        };
        if (res.candidates?.length) {
          citations = res.candidates.map((c) => ({
            no: c.no,
            paperTitle: c.paperTitle,
            page: c.page,
            score: c.score,
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
  const [pipeline, setPipeline] = useState<"agentic" | "naive">("agentic");
  const [input, setInput] = useState("");
  const [showTimeline, setShowTimeline] = useState(true);
  const [ragas, setRagas] = useState<Record<string, Record<string, number>>>({});
  const [evaluating, setEvaluating] = useState<Record<string, boolean>>({});
  const bottomRef = useRef<HTMLDivElement>(null);
  const addRecord = useEvalStore((s) => s.addRecord);

  const { messages, append, isLoading, stop, setMessages, error } = useChat({
    api: "/api/chat",
    body: { pipeline },
  });

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
        pipeline,
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
          pipeline,
          createdAt: new Date().toISOString(),
        });
      })
      .catch(() => toast.warning("RAGAS 评估未完成（不影响回答）"))
      .finally(() => setEvaluating((e) => ({ ...e, [last.id]: false })));
  }, [isLoading, messages, pipeline, ragas, evaluating, addRecord]);

  const send = (text: string) => {
    const t = text.trim();
    if (!t || isLoading) return;
    setInput("");
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
          {/* 管线 A/B 切换 */}
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
          </div>
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
                    className="rounded-xl border bg-card/40 px-4 py-3 text-left text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => {
            if (m.role === "user") {
              return (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground leading-relaxed whitespace-pre-wrap">
                    {m.parts?.find((p) => p.type === "text")?.text ?? ""}
                  </div>
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
                          引用来源
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {citations.map((c) => (
                            <span
                              key={c.no}
                              title={`${c.paperTitle} 第${c.page}页 · 相关度 ${c.score}`}
                              className="citation-chip flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px]"
                            >
                              <span className="font-mono">[{c.no}]</span>
                              <FileText className="size-3" />
                              <span className="max-w-48 truncate">{c.paperTitle}</span>
                              <span className="opacity-70 font-mono">P{c.page}</span>
                            </span>
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
                  : "基线模式：单轮向量检索问答（用于 A/B 对比）"
              }
              className="max-h-44 min-h-[52px] resize-none border-0 bg-transparent px-4 py-3.5 pr-24 text-sm focus-visible:ring-0"
              rows={1}
            />
            <div className="absolute bottom-2.5 right-2.5 flex items-center gap-1.5">
              {isLoading ? (
                <Button size="icon" className="size-8 rounded-xl" onClick={() => stop()} title="停止生成">
                  <Square className="size-3.5" />
                </Button>
              ) : (
                <Button
                  size="icon"
                  className="size-8 rounded-xl"
                  disabled={!input.trim()}
                  onClick={() => send(input)}
                  title="发送 (Enter)"
                >
                  <ArrowUp className="size-4" />
                </Button>
              )}
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between px-1 text-[10px] text-muted-foreground">
            <span>Enter 发送 · Shift+Enter 换行 · 回答由 AI 生成并附引用，请核对原文</span>
            <Badge variant="outline" className="font-mono text-[9px]">
              {pipeline === "agentic" ? "Adaptive + CRAG + Self-RAG" : "Naive RAG"}
            </Badge>
          </div>
        </div>
      </div>
    </div>
  );
}
