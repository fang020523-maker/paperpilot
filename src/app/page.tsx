"use client";

import Link from "next/link";
import { ArrowRight, BookMarked, Layers, Network, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const SUGGESTIONS = [
  {
    title: "跨论文综合",
    question: "Self-RAG 和 CRAG 在检索质量控制策略上有什么本质区别？",
  },
  {
    title: "多跳推理",
    question: "Adaptive-RAG 中使用的评测数据集还被哪些工作采用？",
  },
  {
    title: "领域综述",
    question: "知识库中的论文主要覆盖了哪些技术路线和主题？",
  },
];

const TECH_PILLS = [
  "Agentic RAG",
  "HyDE",
  "混合检索 + RRF",
  "GraphRAG",
  "Louvain 社区发现",
  "Self-RAG 反思",
  "CRAG 纠错",
  "RAGAS 评估",
  "端侧 WebGPU",
];

export default function Home() {
  return (
    <div className="relative flex-1 flex flex-col items-center justify-center overflow-y-auto thin-scrollbar">
      {/* 背景网格 */}
      <div className="hero-grid pointer-events-none absolute inset-0" />

      <div className="relative z-10 mx-auto max-w-3xl px-6 py-16 text-center">
        <Badge variant="secondary" className="mb-5 gap-1.5 px-3 py-1">
          <Sparkles className="size-3.5 text-primary" />
          全国高校 AI Web 开发挑战赛 · RAG 知识问答系统
        </Badge>

        <h1 className="text-4xl md:text-5xl font-bold tracking-tight leading-tight">
          让每一篇文献，
          <br className="md:hidden" />
          <span className="text-gradient-brand">都被真正读懂</span>
        </h1>
        <p className="mt-5 text-muted-foreground text-base md:text-lg leading-relaxed max-w-xl mx-auto">
          上传论文构建你的私人研究知识库。Agentic RAG 流水线自主决策检索策略，
          知识图谱打通跨论文关联，每个论断可溯源、每次回答可评估。
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg" className="gap-2">
            <Link href="/library">
              <BookMarked className="size-4.5" />
              导入第一批文献
              <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="gap-2">
            <Link href="/graph">
              <Network className="size-4.5" />
              查看知识图谱
            </Link>
          </Button>
        </div>

        {/* 技术矩阵 */}
        <div className="mt-10 flex flex-wrap justify-center gap-2">
          {TECH_PILLS.map((t) => (
            <span
              key={t}
              className="rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs text-muted-foreground font-mono"
            >
              {t}
            </span>
          ))}
        </div>

        {/* 能力卡片 */}
        <div className="mt-12 grid gap-4 sm:grid-cols-3 text-left">
          {[
            {
              icon: Layers,
              title: "自适应检索",
              desc: "Adaptive-RAG 按查询复杂度路由：直答 / 单轮 / 迭代多跳 / 图谱全局",
            },
            {
              icon: Network,
              title: "图谱推理",
              desc: "实体关系抽取 + 社区发现，跨论文多跳问题如「哪些工作共用同一数据集」",
            },
            {
              icon: ShieldCheck,
              title: "可信可溯源",
              desc: "论断级引用定位到页码，库外问题明确拒答，RAGAS 四指标量化评估",
            },
          ].map((c) => (
            <div key={c.title} className="panel-glass rounded-xl p-4">
              <c.icon className="size-5 text-primary mb-2.5" />
              <div className="font-medium text-sm">{c.title}</div>
              <div className="mt-1 text-xs text-muted-foreground leading-relaxed">{c.desc}</div>
            </div>
          ))}
        </div>

        {/* 建议问题预览 */}
        <div className="mt-10 text-left">
          <div className="text-xs text-muted-foreground mb-2.5 font-mono">// 导入文献后将解锁的能力示例</div>
          <div className="space-y-2">
            {SUGGESTIONS.map((s) => (
              <div
                key={s.question}
                className="panel-glass flex items-center gap-3 rounded-lg px-4 py-3 text-sm"
              >
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  {s.title}
                </Badge>
                <span className="text-muted-foreground">{s.question}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
