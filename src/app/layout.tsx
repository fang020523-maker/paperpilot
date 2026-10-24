import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { AppSidebar } from "@/components/app-sidebar";
import { MobileNav } from "@/components/mobile-nav";

function MobileNavWrapper() {
  return <MobileNav />;
}

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "PaperPilot 文翰 · Agentic RAG 学术文献智能问答",
    template: "%s · PaperPilot",
  },
  description:
    "基于 Agentic RAG 与 GraphRAG 的学术文献智能问答系统：混合检索、知识图谱、引用溯源、RAGAS 质量评估，支持浏览器端侧 Embedding 隐私模式。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>
          <div className="flex flex-1 min-h-0">
            <AppSidebar />
            <main className="flex-1 min-w-0 flex flex-col">
              <MobileNavWrapper />
              {children}
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
