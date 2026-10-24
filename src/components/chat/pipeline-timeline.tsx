"use client";

import { useState } from "react";
import {
  BadgeCheck,
  ChevronDown,
  CircleCheck,
  CircleX,
  Compass,
  Loader2,
  Network,
  Search,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** 工具调用步骤（AI SDK tool-invocation part 的渲染视图） */
export interface StepPart {
  toolName: string;
  state: "partial-streaming-input" | "streaming-input" | "result" | "result-error" | "partial-call" | "call";
  args?: unknown;
  result?: unknown;
}

const COMPLEXITY_LABEL: Record<string, { label: string; color: string }> = {
  chitchat: { label: "寒暄", color: "#64748b" },
  simple: { label: "常识", color: "#06b6d4" },
  factual: { label: "事实查询", color: "#6366f1" },
  "multi-hop": { label: "多跳推理", color: "#a855f7" },
  "global-summary": { label: "领域综述", color: "#f59e0b" },
};

function StepShell({
  icon,
  title,
  subtitle,
  running,
  error,
  children,
  defaultOpen = false,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: React.ReactNode;
  running?: boolean;
  error?: boolean;
  children?: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const hasDetail = !!children;
  return (
    <div className="relative pl-7">
      {/* 时间线节点 */}
      <span className="absolute left-0 top-0.5 flex size-5 items-center justify-center">
        {running ? (
          <Loader2 className="size-4 animate-spin text-primary" />
        ) : error ? (
          <CircleX className="size-4 text-destructive" />
        ) : (
          <CircleCheck className="size-4 text-emerald-500" />
        )}
      </span>
      <button
        type="button"
        disabled={!hasDetail}
        onClick={() => hasDetail && setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center gap-2 text-left text-xs",
          hasDetail && "cursor-pointer hover:text-foreground"
        )}
      >
        <span className="flex size-5 items-center justify-center text-primary">{icon}</span>
        <span className="font-medium">{title}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{subtitle}</span>
        {hasDetail && (
          <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        )}
      </button>
      {hasDetail && open && (
        <div className="mt-2 rounded-lg border bg-muted/20 p-3 text-xs leading-relaxed">
          {children}
        </div>
      )}
    </div>
  );
}

export function PipelineTimeline({ steps }: { steps: StepPart[] }) {
  if (steps.length === 0) return null;
  return (
    <div className="relative space-y-3.5 before:absolute before:left-[9.5px] before:top-2 before:h-[calc(100%-8px)] before:w-px timeline-line">
      {steps.map((step, i) => {
        const running =
          step.state === "streaming-input" ||
          step.state === "partial-streaming-input" ||
          step.state === "partial-call" ||
          step.state === "call";
        const error = step.state === "result-error";
        const args = (step.args ?? {}) as Record<string, unknown>;
        const result = (step.result ?? {}) as Record<string, unknown>;

        // ── classify_query ──
        if (step.toolName === "classify_query") {
          const comp = (result.complexity as string) ?? "…";
          const meta = COMPLEXITY_LABEL[comp];
          return (
            <StepShell
              key={i}
              icon={<Compass className="size-4" />}
              title="查询分类路由"
              subtitle={
                running
                  ? "判定问题复杂度…"
                  : !error && (
                      <>
                        <span style={{ color: meta?.color }}>{meta?.label ?? comp}</span>
                        <span className="ml-1.5">{String(result.strategy ?? "")}</span>
                      </>
                    )
              }
              running={running}
              error={error}
            >
              <div className="space-y-1.5">
                <div>问题：{String(args.question ?? "")}</div>
                <div className="text-muted-foreground">理由：{String(result.reason ?? "")}</div>
                <Badge variant="outline" className="font-mono text-[9px]">Adaptive-RAG 路由</Badge>
              </div>
            </StepShell>
          );
        }

        // ── hybrid_retrieve ──
        if (step.toolName === "hybrid_retrieve") {
          const candidates = (result.candidates as { no: number; paperTitle: string; page: number; score: number; method: string }[]) ?? [];
          const expansion = (result.queryExpansion ?? {}) as { rewritten?: string; multiQueries?: string[]; hydeUsed?: boolean };
          return (
            <StepShell
              key={i}
              icon={<Search className="size-4" />}
              title="混合检索"
              subtitle={
                running
                  ? `检索：${String(args.query ?? "").slice(0, 60)}`
                  : !error && `${candidates.length} 个候选 · ${expansion.hydeUsed ? "HyDE+" : ""}BM25+向量 → RRF 融合 → 重排序`
              }
              running={running}
              error={error}
            >
              <div className="space-y-2">
                {expansion.rewritten && (
                  <div>
                    <span className="text-muted-foreground">改写：</span>
                    {expansion.rewritten}
                  </div>
                )}
                {expansion.multiQueries?.length ? (
                  <div>
                    <span className="text-muted-foreground">多视角：</span>
                    {expansion.multiQueries.join(" / ")}
                  </div>
                ) : null}
                {expansion.hydeUsed && (
                  <Badge variant="secondary" className="text-[9px]">HyDE 假设文档已生成</Badge>
                )}
                <div className="space-y-1">
                  {candidates.map((c) => (
                    <div key={c.no} className="flex items-center gap-2">
                      <span className="citation-chip flex size-4 shrink-0 items-center justify-center rounded text-[9px] font-mono">
                        {c.no}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {c.paperTitle} <span className="text-muted-foreground">P{c.page}</span>
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{c.score}</span>
                    </div>
                  ))}
                </div>
              </div>
            </StepShell>
          );
        }

        // ── grade_documents ──
        if (step.toolName === "grade_documents") {
          const grades = (result.grades as { chunkId: string; paperTitle: string; score: number; reason: string }[]) ?? [];
          const avg = result.averageScore as number | undefined;
          const action = result.correctiveAction as string | undefined;
          return (
            <StepShell
              key={i}
              icon={<ShieldCheck className="size-4" />}
              title="证据质量评估"
              subtitle={
                running
                  ? "逐条评分候选片段…"
                  : !error && (
                      <>
                        平均 <span className={cn("font-mono", (avg ?? 0) >= 6 ? "text-emerald-500" : "text-amber-500")}>{avg}</span>
                        <span className="ml-1.5">
                          {action === "accept" ? "采纳" : action === "rewrite" ? "触发纠错重检索" : "无可用证据"}
                        </span>
                      </>
                    )
              }
              running={running}
              error={error}
            >
              <div className="space-y-1.5">
                {grades.map((g) => (
                  <div key={g.chunkId} className="flex items-start gap-2">
                    <span
                      className={cn(
                        "mt-0.5 w-6 shrink-0 rounded px-1 text-center font-mono text-[10px]",
                        g.score >= 7
                          ? "bg-emerald-500/15 text-emerald-500"
                          : g.score >= 4
                            ? "bg-amber-500/15 text-amber-500"
                            : "bg-destructive/15 text-destructive"
                      )}
                    >
                      {g.score}
                    </span>
                    <span className="min-w-0 flex-1">
                      {g.paperTitle.slice(0, 50)}
                      <span className="text-muted-foreground"> — {g.reason}</span>
                    </span>
                  </div>
                ))}
                <Badge variant="outline" className="font-mono text-[9px]">CRAG 纠错式检索增强</Badge>
              </div>
            </StepShell>
          );
        }

        // ── graph_search ──
        if (step.toolName === "graph_search") {
          const entitiesHit = (result.entitiesHit as { name: string; type: string; mentions: number }[]) ?? [];
          const relations = (result.relations as { source: string; label: string; target: string }[]) ?? [];
          const communities = (result.communities as { size: number; summary?: string }[]) ?? [];
          return (
            <StepShell
              key={i}
              icon={<Network className="size-4" />}
              title={args.mode === "global" ? "图谱全局检索" : "图谱邻域检索"}
              subtitle={
                running
                  ? `图谱查询：${String(args.query ?? "").slice(0, 50)}`
                  : !error && (
                      <>
                        命中 {entitiesHit.length} 实体
                        {relations.length > 0 && ` · ${relations.length} 关系`}
                        {communities.length > 0 && ` · ${communities.length} 社区`}
                      </>
                    )
              }
              running={running}
              error={error}
            >
              <div className="space-y-2">
                {entitiesHit.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {entitiesHit.map((e) => (
                      <Badge key={e.name} variant="secondary" className="text-[10px]">
                        {e.name}
                      </Badge>
                    ))}
                  </div>
                )}
                {relations.slice(0, 8).map((r, j) => (
                  <div key={j} className="font-mono text-[10px] text-muted-foreground">
                    {r.source} <span className="text-primary">—[{r.label}]→</span> {r.target}
                  </div>
                ))}
                {communities.map((c, j) => (
                  <div key={j} className="text-muted-foreground">
                    社区（{c.size} 实体）：{c.summary}
                  </div>
                ))}
                <Badge variant="outline" className="font-mono text-[9px]">GraphRAG {String(args.mode ?? "")}</Badge>
              </div>
            </StepShell>
          );
        }

        // ── self_assess ──
        if (step.toolName === "self_assess") {
          const claims = (args.claims as string[]) ?? [];
          const score = result.supportScore as number | undefined;
          const verdict = result.verdict as string | undefined;
          return (
            <StepShell
              key={i}
              icon={<BadgeCheck className="size-4" />}
              title="自反思验证"
              subtitle={
                running
                  ? "验证论断支撑度…"
                  : !error && (
                      <>
                        支撑度 <span className={cn("font-mono", (score ?? 0) >= 7 ? "text-emerald-500" : "text-amber-500")}>{score}/10</span>
                        <span className="ml-1.5">{verdict?.slice(0, 40)}</span>
                      </>
                    )
              }
              running={running}
              error={error}
            >
              <ul className="list-disc space-y-1 pl-4">
                {claims.map((cl, j) => (
                  <li key={j}>{cl}</li>
                ))}
              </ul>
              <div className="mt-2 text-muted-foreground">{verdict}</div>
              <Badge variant="outline" className="mt-2 font-mono text-[9px]">Self-RAG 反思</Badge>
            </StepShell>
          );
        }

        // 未知工具
        return (
          <StepShell key={i} icon={<Compass className="size-4" />} title={step.toolName} running={running} error={error}>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-[10px]">
              {JSON.stringify(step.result ?? step.args, null, 2)}
            </pre>
          </StepShell>
        );
      })}
    </div>
  );
}
