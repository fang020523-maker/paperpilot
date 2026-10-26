import { describe, it, expect } from "vitest";
import { assignCommunities, buildCooccurrenceGraph } from "./cooccurrence";
import type { Chunk } from "../types";

const mkChunks = (texts: string[]): Chunk[] =>
  texts.map((text, i) => ({
    id: `p1:${i}`,
    paperId: "p1",
    index: i,
    page: i + 1,
    rawText: text,
    text,
    embeddingSource: "local" as const,
    tokenEstimate: 100,
  }));

describe("buildCooccurrenceGraph（术语共现降级图谱）", () => {
  const chunks = mkChunks([
    "Self-RAG is evaluated on ASQA using GPT-4 as the critic teacher.",
    "CRAG uses a retrieval evaluator; experiments cover ASQA and PopQA.",
    "The Transformer architecture underpins GPT-3 and BERT.",
  ]);

  it("词典术语被登记为实体", () => {
    const { entities } = buildCooccurrenceGraph("p1", "Test Paper", chunks);
    for (const name of ["Self-RAG", "CRAG", "ASQA", "GPT-4", "PopQA", "GPT-3", "BERT"]) {
      const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      expect(entities.has(key), `missing entity ${name}`).toBe(true);
    }
  });

  it("同块共现术语建立关系（Self-RAG—ASQA）", () => {
    const { relations } = buildCooccurrenceGraph("p1", "Test Paper", chunks);
    const has = [...relations.keys()].some(
      (id) =>
        (id.includes("self-rag") && id.includes("asqa")) ||
        (id.includes("asqa") && id.includes("self-rag"))
    );
    expect(has).toBe(true);
  });

  it("无词典术语的文本产出空图", () => {
    const { entities, relations } = buildCooccurrenceGraph(
      "p1",
      "T",
      mkChunks(["plain text without any known terminology here"])
    );
    expect(entities.size).toBe(0);
    expect(relations.size).toBe(0);
  });

  it("提及计数跨块累积", () => {
    const { entities } = buildCooccurrenceGraph("p1", "T", chunks);
    const asqa = entities.get("asqa");
    expect(asqa!.mentions[0].chunkIds.length).toBe(2);
  });
});

describe("assignCommunities（Louvain 社区）", () => {
  it("对双子图给出至少一个社区并回填 communityId", () => {
    // 两组高内聚术语
    const chunks = mkChunks([
      "Self-RAG ASQA GPT-4. ".repeat(3),
      "CRAG PopQA ChatGPT. ".repeat(3),
      "Self-RAG ASQA. GPT-4.",
    ]);
    const { entities, relations } = buildCooccurrenceGraph("p1", "T", chunks);
    const communities = assignCommunities(entities, relations);
    expect(communities.length).toBeGreaterThanOrEqual(1);
    for (const c of communities) {
      expect(c.size).toBeGreaterThanOrEqual(2);
      expect(c.summary).toBeTruthy();
      for (const id of c.entityIds) {
        expect(entities.get(id)!.communityId).toBeDefined();
      }
    }
  });
});
