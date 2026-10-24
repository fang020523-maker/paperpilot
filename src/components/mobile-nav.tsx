"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpenText, ChartNoAxesCombined, MessagesSquare, Network } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "问答", icon: MessagesSquare },
  { href: "/library", label: "文献库", icon: BookOpenText },
  { href: "/graph", label: "图谱", icon: Network },
  { href: "/analytics", label: "评估", icon: ChartNoAxesCombined },
];

export function MobileNav() {
  const pathname = usePathname();
  return (
    <header className="md:hidden sticky top-0 z-40 flex items-center gap-1 border-b bg-background/80 backdrop-blur px-3 py-2">
      <div className="flex items-center gap-2 mr-auto">
        <BookOpenText className="size-5 text-primary" />
        <span className="font-semibold text-sm">
          PaperPilot <span className="text-gradient-brand">文翰</span>
        </span>
      </div>
      {NAV.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex flex-col items-center rounded-md px-2 py-1 text-[10px]",
              active ? "text-primary" : "text-muted-foreground"
            )}
          >
            <item.icon className="size-4" />
            {item.label}
          </Link>
        );
      })}
    </header>
  );
}
