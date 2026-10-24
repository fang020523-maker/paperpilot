"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { FlaskConical, Gauge, ListChecks, Timer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useEvalStore } from "@/stores/eval-history";

const METRICS = [
  { key: "faithfulness", label: "忠实度" },
  { key: "answerRelevancy", label: "答案相关性" },
  { key: "contextPrecision", label: "上下文精确率" },
  { key: "contextRecall", label: "上下文召回率" },
] as const;

type MetricKey = (typeof METRICS)[number]["key"];

function avg(records: { scores: { [K in MetricKey]: number } }[], key: MetricKey): number {
  if (records.length === 0) return 0;
  return records.reduce((s, r) => s + (r.scores[key] ?? 0), 0) / records.length;
}

export default function AnalyticsPage() {
  const records = useEvalStore((s) => s.records);
  const clear = useEvalStore((s) => s.clear);

  const agentic = records.filter((r) => r.pipeline === "agentic");
  const naive = records.filter((r) => r.pipeline === "naive");

  const radarData = METRICS.map((m) => ({
    metric: m.label,
    agentic: Number(avg(agentic, m.key).toFixed(2)),
    naive: Number(avg(naive, m.key).toFixed(2)),
  }));

  // 趋势：按时间正序最近 30 条
  const trend = useMemo(
    () =>
      [...records]
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(-30)
        .map((r, i) => ({
          i: i + 1,
          faithfulness: r.scores.faithfulness,
          relevancy: r.scores.answerRelevancy,
          pipeline: r.pipeline,
        })),
    [records]
  );

  const avgLatency =
    records.length > 0
      ? records.reduce((s, r) => s + (r.scores.latencyMs ?? 0), 0) / records.length / 1000
      : 0;

  return (
    <div className="flex-1 overflow-y-auto thin-scrollbar">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">质量评估仪表盘</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              每次问答自动进行 RAGAS 四指标 LLM-as-a-judge 评估（arXiv:2309.15217）
            </p>
          </div>
          {records.length > 0 && (
            <Button variant="outline" size="sm" onClick={clear}>
              清空评估历史
            </Button>
          )}
        </div>

        {records.length === 0 ? (
          <div className="mt-16 flex flex-col items-center justify-center rounded-2xl border border-dashed p-16 text-center">
            <Gauge className="size-10 text-muted-foreground/40" />
            <div className="mt-3 text-sm font-medium">暂无评估数据</div>
            <div className="mt-1 max-w-sm text-xs text-muted-foreground">
              去智能问答页提问，系统会在每次回答完成后自动评分；
              用顶部的「Agentic / 基线」切换对比两种管线的质量差异
            </div>
          </div>
        ) : (
          <>
            {/* 概览卡片 */}
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  icon: ListChecks,
                  label: "累计评估",
                  value: `${records.length} 次`,
                  sub: `Agentic ${agentic.length} · 基线 ${naive.length}`,
                },
                ...METRICS.map((m) => ({
                  icon: FlaskConical,
                  label: `${m.label}（均值）`,
                  value: avg(records, m.key).toFixed(2),
                  sub: `Agentic ${avg(agentic, m.key).toFixed(2)} vs 基线 ${avg(naive, m.key).toFixed(2)}`,
                })),
              ].map((c) => (
                <div key={c.label} className="rounded-xl border bg-card/60 p-4">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <c.icon className="size-3.5" />
                    {c.label}
                  </div>
                  <div className="mt-2 text-2xl font-semibold">{c.value}</div>
                  <div className="mt-1 font-mono text-[10px] text-muted-foreground">{c.sub}</div>
                </div>
              ))}
              <div className="rounded-xl border bg-card/60 p-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Timer className="size-3.5" />
                  平均端到端时延
                </div>
                <div className="mt-2 text-2xl font-semibold">{avgLatency.toFixed(1)}s</div>
                <div className="mt-1 font-mono text-[10px] text-muted-foreground">含检索与评估</div>
              </div>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-5">
              {/* 雷达对比 */}
              <div className="rounded-2xl border bg-card/50 p-5 lg:col-span-2">
                <div className="mb-3 text-sm font-medium">管线 A/B 对比（均值雷达）</div>
                <ResponsiveContainer width="100%" height={280}>
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="rgba(148,163,184,0.2)" />
                    <PolarAngleAxis dataKey="metric" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                    <PolarRadiusAxis domain={[0, 1]} tick={{ fill: "#64748b", fontSize: 9 }} />
                    <Radar name="Agentic RAG" dataKey="agentic" stroke="#818cf8" fill="#818cf8" fillOpacity={0.35} />
                    <Radar name="朴素基线" dataKey="naive" stroke="#fbbf24" fill="#fbbf24" fillOpacity={0.15} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Tooltip contentStyle={{ fontSize: 12, background: "#1e293b", border: "none" }} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>

              {/* 趋势 */}
              <div className="rounded-2xl border bg-card/50 p-5 lg:col-span-3">
                <div className="mb-3 text-sm font-medium">最近 30 次评估趋势</div>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={trend}>
                    <CartesianGrid stroke="rgba(148,163,184,0.12)" />
                    <XAxis dataKey="i" tick={{ fill: "#64748b", fontSize: 10 }} />
                    <YAxis domain={[0, 1]} tick={{ fill: "#64748b", fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{ fontSize: 12, background: "#1e293b", border: "none" }}
                      formatter={((v: unknown, name: unknown) => [
                        typeof v === "number" ? v.toFixed(2) : String(v),
                        name === "faithfulness" ? "忠实度" : "相关性",
                      ]) as never}
                    />
                    <Line type="monotone" dataKey="faithfulness" stroke="#818cf8" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="relevancy" stroke="#34d399" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 历史明细 */}
            <div className="mt-6 rounded-2xl border bg-card/50">
              <div className="border-b px-5 py-3 text-sm font-medium">评估历史</div>
              <div className="divide-y">
                {records.slice(0, 50).map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <Badge
                      variant="outline"
                      className={
                        r.pipeline === "agentic"
                          ? "border-primary/40 text-primary"
                          : "border-amber-500/40 text-amber-500"
                      }
                    >
                      {r.pipeline === "agentic" ? "Agentic" : "基线"}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{r.question}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{r.answerPreview}…</div>
                    </div>
                    <div className="flex shrink-0 gap-3 font-mono text-[11px]">
                      {METRICS.map((m) => {
                        const v = r.scores[m.key];
                        return (
                          <span key={m.key}>
                            <span className="text-muted-foreground">{m.label[0]}</span>{" "}
                            <span className={v >= 0.75 ? "text-emerald-500" : v >= 0.5 ? "text-amber-500" : "text-destructive"}>
                              {v.toFixed(2)}
                            </span>
                          </span>
                        );
                      })}
                    </div>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {new Date(r.createdAt).toLocaleString("zh-CN", { hour12: false })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
