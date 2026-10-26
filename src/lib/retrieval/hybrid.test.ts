import { describe, it, expect } from "vitest";
import { orderForContext } from "./hybrid";
import type { RetrievedChunk } from "../types";

const mk = (score: number, name: string): RetrievedChunk =>
  ({
    chunk: { id: name, paperId: "p", index: 0, page: 1, rawText: name, text: name, embeddingSource: "local", tokenEstimate: 10 },
    paper: {
      id: "p", title: name, authors: [], filename: "x.pdf", pageCount: 1,
      chunkCount: 1, status: "ready", createdAt: "",
    },
    score,
    method: "vector",
  }) as unknown as RetrievedChunk;

describe("orderForContext（Lost in the Middle 蛇形重排）", () => {
  it("最强证据位于首尾，弱证据沉入中部", () => {
    const items = [mk(1, "a"), mk(5, "b"), mk(3, "c"), mk(9, "d"), mk(7, "e")];
    const ordered = orderForContext(items);
    // 排序后：9(e→第1), 7(第2), 5(尾), 3, 1 沉底 —— 首尾应为最高分
    expect(ordered[0].score).toBe(9);
    expect(ordered[ordered.length - 1].score).toBe(7);
    // 中部为弱证据
    expect(ordered[Math.floor(ordered.length / 2)].score).toBeLessThanOrEqual(3);
  });

  it("rank 从 1 开始连续编号", () => {
    const ordered = orderForContext([mk(2, "a"), mk(1, "b"), mk(3, "c")]);
    expect(ordered.map((o) => o.rank)).toEqual([1, 2, 3]);
  });

  it("不改变输入数组（纯函数）", () => {
    const items = [mk(1, "a"), mk(2, "b")];
    orderForContext(items);
    expect(items[0].score).toBe(1);
    expect(items[0].rank).toBeUndefined();
  });
});
