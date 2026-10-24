"use client";

/**
 * d3-force 力导向图谱渲染（Canvas）
 * - 社区聚类着色（Louvain 结果）
 * - 节点半径 = 提及次数，实体类型图标色
 * - 悬停高亮邻域、点击查看实体详情（提及论文 + 关系）
 * - 缩放/拖拽/平移
 */
import { useEffect, useRef, useState } from "react";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type Simulation,
  type SimulationNodeDatum,
} from "d3-force";
import { ENTITY_TYPE_META, type EntityType } from "@/lib/types";

export interface GraphNode extends SimulationNodeDatum {
  id: string;
  name: string;
  type: EntityType;
  mentions: number;
  paperCount: number;
  communityId: number | null;
  aliases?: string[];
}
export interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  label: string;
  weight: number;
}

const COMMUNITY_PALETTE = [
  "#818cf8", "#34d399", "#fbbf24", "#f472b6", "#22d3ee",
  "#a78bfa", "#fb923c", "#4ade80", "#e879f9", "#38bdf8",
  "#f87171", "#2dd4bf",
];

function communityColor(c: number | null): string {
  if (c === null) return "#94a3b8";
  return COMMUNITY_PALETTE[c % COMMUNITY_PALETTE.length];
}

export function ForceGraph({
  nodes: inNodes,
  links: inLinks,
  onNodeClick,
}: {
  nodes: GraphNode[];
  links: GraphLink[];
  onNodeClick?: (node: GraphNode) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<Simulation<GraphNode, undefined> | null>(null);
  const stateRef = useRef({
    nodes: [] as GraphNode[],
    links: [] as GraphLink[],
    transform: { k: 1, x: 0, y: 0 },
    hover: null as GraphNode | null,
    selected: null as GraphNode | null,
  });

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext("2d")!;
    const S = stateRef.current;

    // 深拷贝节点，避免复用上一次模拟的坐标
    S.nodes = inNodes.map((n) => ({ ...n }));
    const nodeById = new Map(S.nodes.map((n) => [n.id, n]));
    S.links = inLinks
      .filter((l) => nodeById.has(l.source as string) && nodeById.has(l.target as string))
      .map((l) => ({ ...l, source: nodeById.get(l.source as string)!, target: nodeById.get(l.target as string)! }));
    S.transform = { k: 1, x: 0, y: 0 };
    S.hover = null;
    S.selected = null;

    let width = wrap.clientWidth;
    let height = wrap.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      width = wrap.clientWidth;
      height = wrap.clientHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const sim = forceSimulation<GraphNode>(S.nodes)
      .force(
        "link",
        forceLink<GraphNode, GraphLink>(S.links)
          .id((d) => d.id)
          .distance(70)
          .strength((l) => Math.min(0.35, 0.08 + l.weight * 0.04))
      )
      .force("charge", forceManyBody().strength((d) => -90 - (d as GraphNode).mentions * 6))
      .force("center", forceCenter(width / 2, height / 2))
      .force("collide", forceCollide<GraphNode>((d) => 6 + Math.sqrt(d.mentions) * 3.2))
      .alphaDecay(0.02);
    simRef.current = sim;

    const radius = (d: GraphNode) => 4.5 + Math.sqrt(d.mentions) * 2.6;

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const t = S.transform;
      ctx.translate(t.x, t.y);
      ctx.scale(t.k, t.k);

      const focus = S.hover ?? S.selected;
      const focusNeighbors = new Set<string>();
      if (focus) {
        focusNeighbors.add(focus.id);
        for (const l of S.links) {
          const s = l.source as GraphNode;
          const tg = l.target as GraphNode;
          if (s.id === focus.id) focusNeighbors.add(tg.id);
          if (tg.id === focus.id) focusNeighbors.add(s.id);
        }
      }

      // 边
      for (const l of S.links) {
        const s = l.source as GraphNode;
        const tg = l.target as GraphNode;
        if (s.x === undefined || tg.x === undefined) continue;
        const dimmed = focus && !(focusNeighbors.has(s.id) && focusNeighbors.has(tg.id));
        ctx.strokeStyle = dimmed ? "rgba(148,163,184,0.06)" : "rgba(129,140,248,0.28)";
        ctx.lineWidth = dimmed ? 0.5 : Math.min(2.4, 0.7 + l.weight * 0.3);
        ctx.beginPath();
        ctx.moveTo(s.x!, s.y!);
        ctx.lineTo(tg.x!, tg.y!);
        ctx.stroke();
      }

      // 节点
      for (const d of S.nodes) {
        if (d.x === undefined || d.y === undefined) continue;
        const r = radius(d);
        const isFocus = focus?.id === d.id;
        const inHood = !focusNeighbors.size || focusNeighbors.has(d.id);
        ctx.globalAlpha = inHood ? 1 : 0.15;
        const color = d.communityId !== null && d.communityId !== undefined
          ? communityColor(d.communityId)
          : ENTITY_TYPE_META[d.type]?.color ?? "#94a3b8";
        ctx.beginPath();
        ctx.arc(d.x, d.y, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        if (isFocus) {
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        // 标签（重要节点或悬停邻域）
        if (inHood && (t.k > 1.15 || d.mentions >= 3 || isFocus)) {
          ctx.globalAlpha = inHood ? 0.92 : 0.12;
          ctx.font = `${isFocus ? 12 : 10.5}px ui-sans-serif, system-ui`;
          ctx.fillStyle = "#e2e8f0";
          ctx.textAlign = "center";
          ctx.fillText(d.name, d.x, d.y - r - 4);
        }
        ctx.globalAlpha = 1;
      }
      requestAnimationFrame(draw);
    };
    const raf = requestAnimationFrame(draw);

    // 交互：缩放 + 平移
    const toWorld = (cx: number, cy: number) => ({
      x: (cx - S.transform.x) / S.transform.k,
      y: (cy - S.transform.y) / S.transform.k,
    });
    const pick = (cx: number, cy: number): GraphNode | null => {
      const p = toWorld(cx, cy);
      let best: GraphNode | null = null;
      let bestD = 18;
      for (const d of S.nodes) {
        if (d.x === undefined || d.y === undefined) continue;
        const dist = Math.hypot(d.x - p.x, d.y - p.y);
        if (dist < bestD) {
          bestD = dist;
          best = d;
        }
      }
      return best;
    };
    let dragging = false;
    let dragNode: GraphNode | null = null;
    let panning = false;
    let last = { x: 0, y: 0 };
    const getPos = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const k = Math.max(0.35, Math.min(4, S.transform.k * (e.deltaY < 0 ? 1.12 : 0.89)));
      S.transform.k = k;
    };
    const onPointerDown = (e: PointerEvent) => {
      const p = getPos(e);
      const n = pick(p.x, p.y);
      if (n) {
        dragNode = n;
        dragging = true;
      } else {
        panning = true;
      }
      last = p;
    };
    const onPointerMove = (e: PointerEvent) => {
      const p = getPos(e);
      if (dragging && dragNode) {
        const w = toWorld(p.x, p.y);
        dragNode.fx = w.x;
        dragNode.fy = w.y;
        sim.alpha(0.3).restart();
      } else if (panning) {
        S.transform.x += p.x - last.x;
        S.transform.y += p.y - last.y;
      } else {
        S.hover = pick(p.x, p.y);
        canvas.style.cursor = S.hover ? "pointer" : "default";
      }
      last = p;
    };
    const onPointerUp = () => {
      if (dragNode) {
        dragNode.fx = null;
        dragNode.fy = null;
      }
      dragging = false;
      dragNode = null;
      panning = false;
    };
    const onClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const n = pick(e.clientX - rect.left, e.clientY - rect.top);
      S.selected = n;
      if (n) onNodeClick?.(n);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointerleave", onPointerUp);
    canvas.addEventListener("click", onClick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      sim.stop();
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerUp);
      canvas.removeEventListener("click", onClick);
    };
  }, [inNodes, inLinks, onNodeClick]);

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden">
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
