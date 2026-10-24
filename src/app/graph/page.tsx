"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Inbox, Loader2, Network, Users, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ENTITY_TYPE_META, type EntityType } from "@/lib/types";
import { ForceGraph, type GraphNode } from "@/components/graph/force-graph";
import { cn } from "@/lib/utils";

interface GraphResponse {
  nodes: (GraphNode & { aliases?: string[] })[];
  links: { source: string; target: string; label: string; weight: number; evidenceCount: number }[];
  communities: { id: number; size: number; summary?: string }[];
  stats: { papers: number; entities: number; relations: number; communities: number };
}

export default function GraphPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["graph"],
    queryFn: async (): Promise<GraphResponse> => {
      const res = await fetch("/api/graph");
      return res.json();
    },
  });

  const [typeFilter, setTypeFilter] = useState<Set<EntityType>>(new Set());
  const [minMentions, setMinMentions] = useState(1);
  const [colorByCommunity, setColorByCommunity] = useState(true);
  const [selected, setSelected] = useState<(GraphNode & { aliases?: string[] }) | null>(null);

  // 应用过滤器
  const filtered = useMemo(() => {
    if (!data) return { nodes: [], links: [] };
    const nodes = data.nodes.filter(
      (n) =>
        (typeFilter.size === 0 || typeFilter.has(n.type)) && n.mentions >= minMentions
    );
    const ids = new Set(nodes.map((n) => n.id));
    const links = data.links.filter(
      (l) => ids.has(l.source) && ids.has(l.target)
    );
    const finalIds = new Set<string>();
    links.forEach((l) => {
      finalIds.add(l.source);
      finalIds.add(l.target);
    });
    return {
      nodes: nodes.filter((n) => finalIds.size === 0 || finalIds.has(n.id)),
      links,
    };
  }, [data, typeFilter, minMentions]);

  const toggleType = (t: EntityType) => {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  const relatedOfSelected = useMemo(() => {
    if (!selected || !data) return [];
    return data.links
      .filter((l) => l.source === selected.id || l.target === selected.id)
      .map((l) => ({
        label: l.label,
        other: l.source === selected.id ? l.target : l.source,
        evidenceCount: l.evidenceCount,
      }))
      .slice(0, 14);
  }, [selected, data]);

  return (
    <div className="flex-1 flex min-h-0">
      {/* 主画布 */}
      <div className="relative flex-1 min-w-0">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 size-5 animate-spin" /> 图谱加载中…
          </div>
        ) : !data || data.nodes.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
            <Inbox className="size-10 opacity-40" />
            <div className="mt-3 text-sm">知识图谱为空</div>
            <div className="mt-1 text-xs opacity-70">
              图谱在文献导入时自动构建（实体抽取 → 关系连接 → 社区发现）
            </div>
          </div>
        ) : (
          <>
            <ForceGraph
              nodes={
                colorByCommunity
                  ? filtered.nodes
                  : filtered.nodes.map((n) => ({ ...n, communityId: null }))
              }
              links={filtered.links}
              onNodeClick={(n) =>
                setSelected(data.nodes.find((d) => d.id === n.id) ?? null)
              }
            />
            {/* 图例 */}
            <div className="pointer-events-none absolute left-4 top-4 flex flex-col gap-1.5 rounded-xl border bg-background/70 p-3 backdrop-blur">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                实体类型
              </div>
              {Object.entries(ENTITY_TYPE_META).map(([key, meta]) => (
                <button
                  key={key}
                  onClick={() => toggleType(key as EntityType)}
                  className={cn(
                    "pointer-events-auto flex items-center gap-2 rounded px-1.5 py-0.5 text-[11px] transition-opacity",
                    typeFilter.size > 0 && !typeFilter.has(key as EntityType) && "opacity-35"
                  )}
                >
                  <span className="size-2.5 rounded-full" style={{ background: meta.color }} />
                  {meta.label}
                </button>
              ))}
            </div>
            <div className="pointer-events-none absolute bottom-4 left-4 text-[10px] text-muted-foreground">
              滚轮缩放 · 拖拽平移 · 点击节点查看详情 · 拖动节点扰动布局
            </div>
          </>
        )}
      </div>

      {/* 侧栏 */}
      <div className="hidden w-80 shrink-0 flex-col overflow-y-auto thin-scrollbar border-l lg:flex">
        {/* 统计 + 控制 */}
        <div className="space-y-4 p-4">
          <div className="flex items-center gap-2">
            <Network className="size-4 text-primary" />
            <span className="text-sm font-semibold">知识图谱</span>
            {data && (
              <Badge variant="secondary" className="ml-auto font-mono text-[10px]">
                {filtered.nodes.length}/{data.stats.entities} 实体 · {filtered.links.length} 关系
              </Badge>
            )}
          </div>
          <div>
            <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
              <span>最小提及次数</span>
              <span className="font-mono">{minMentions}</span>
            </div>
            <Slider
              min={1}
              max={8}
              step={1}
              value={[minMentions]}
              onValueChange={(v) => setMinMentions(v[0])}
            />
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">社区聚类着色（Louvain）</span>
            <Switch checked={colorByCommunity} onCheckedChange={setColorByCommunity} />
          </div>
        </div>

        {/* 选中实体详情 */}
        {selected && (
          <div className="border-t p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium leading-snug">{selected.name}</div>
                <Badge variant="outline" className="mt-1 text-[10px]" style={{ color: ENTITY_TYPE_META[selected.type]?.color }}>
                  {ENTITY_TYPE_META[selected.type]?.label ?? selected.type}
                </Badge>
              </div>
              <Button variant="ghost" size="icon" className="size-7" onClick={() => setSelected(null)}>
                <X className="size-3.5" />
              </Button>
            </div>
            {selected.aliases && selected.aliases.length > 0 && (
              <div className="mt-2 text-[11px] text-muted-foreground">
                别名：{selected.aliases.join(" / ")}
              </div>
            )}
            <div className="mt-2 text-[11px] text-muted-foreground">
              被 {selected.paperCount} 篇文献提及 {selected.mentions} 次
              {selected.communityId !== null && ` · 社区 #${selected.communityId}`}
            </div>
            {relatedOfSelected.length > 0 && (
              <div className="mt-3 space-y-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  关联关系（1 跳）
                </div>
                {relatedOfSelected.map((r, i) => (
                  <div key={i} className="rounded-lg border bg-muted/20 px-2.5 py-1.5 font-mono text-[10px] leading-relaxed">
                    <span className="text-primary">—[{r.label}]→</span> {r.other}
                    <span className="ml-1 text-muted-foreground">×{r.evidenceCount}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 社区摘要 */}
        {data && data.communities.length > 0 && (
          <div className="border-t p-4">
            <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Users className="size-3" /> 主题社区（GraphRAG Global Search 检索单元）
            </div>
            <div className="space-y-2">
              {data.communities.map((c) => (
                <div key={c.id} className="rounded-lg border bg-card/50 p-2.5">
                  <div className="text-[10px] font-mono text-muted-foreground">
                    社区 #{c.id} · {c.size} 实体
                  </div>
                  <div className="mt-1 text-[11px] leading-relaxed">{c.summary ?? "（无摘要）"}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
