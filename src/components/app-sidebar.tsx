"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpenText,
  ChartNoAxesCombined,
  MessagesSquare,
  Network,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "智能问答", icon: MessagesSquare, desc: "Agentic RAG" },
  { href: "/library", label: "文献库", icon: BookOpenText, desc: "文献管理" },
  { href: "/graph", label: "知识图谱", icon: Network, desc: "GraphRAG" },
  { href: "/analytics", label: "质量评估", icon: ChartNoAxesCombined, desc: "RAGAS" },
];

export function AppSidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden md:flex w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      {/* 品牌区 */}
      <div className="flex items-center gap-3 px-5 pt-6 pb-5">
        <div className="flex size-9 items-center justify-center rounded-xl bg-primary/15 border border-primary/25">
          <BookOpenText className="size-5 text-primary" />
        </div>
        <div>
          <div className="font-semibold tracking-tight leading-tight">
            PaperPilot <span className="text-gradient-brand">文翰</span>
          </div>
          <div className="text-[11px] text-muted-foreground">学术文献智能问答中枢</div>
        </div>
      </div>

      {/* 导航 */}
      <nav className="flex-1 space-y-1 px-3">
        {NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
              )}
            >
              <item.icon className={cn("size-4.5", active && "text-primary")} />
              <span className="flex-1">{item.label}</span>
              <span
                className={cn(
                  "text-[10px] tracking-wide opacity-60 font-mono",
                  !active && "opacity-0 group-hover:opacity-50"
                )}
              >
                {item.desc}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* 底部状态 */}
      <div className="border-t px-4 py-3.5 text-[10px] leading-relaxed text-muted-foreground">
        <div className="opacity-80">全国高校 AI Web 开发挑战赛</div>
        <div className="mt-0.5 font-mono break-all opacity-60">
          Agentic RAG · GraphRAG · RAGAS
        </div>
      </div>
    </aside>
  );
}
