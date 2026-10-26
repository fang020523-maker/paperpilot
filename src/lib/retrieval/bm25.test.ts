import { describe, it, expect } from "vitest";
import { BM25Index, tokenize } from "./bm25";

describe("tokenize（中英混合分词）", () => {
  it("英文小写化并去停用词", () => {
    const t = tokenize("The Retrieval-Augmented Generation improves answers");
    expect(t).toContain("retrieval-augmented");
    expect(t).toContain("generation");
    expect(t).not.toContain("the");
    expect(t).not.toContain("improves".toUpperCase());
  });

  it("中文按二元组切分", () => {
    const t = tokenize("检索增强生成");
    expect(t).toContain("检索");
    expect(t).toContain("索增");
    expect(t).toContain("增强");
    expect(t).toContain("生成");
  });

  it("中文停用词被过滤但 bigram 仍覆盖其余", () => {
    const t = tokenize("的一个方法");
    // “的”/“一个”为停用词，但连续段“的一个方法”产生的 bigram 中包含有效词元
    expect(t.some((x) => x.includes("方法") || x === "法")).toBe(true);
  });

  it("数字与百分比保留", () => {
    const t = tokenize("FActScore 70.5 and 20%");
    expect(t).toContain("70.5");
    expect(t).toContain("20%");
  });
});

describe("BM25Index", () => {
  it("关键词命中排序：包含查询词的文档排在前面", () => {
    const idx = new BM25Index();
    idx.add("d1", "Self-RAG uses reflection tokens to control retrieval");
    idx.add("d2", "GraphRAG builds a knowledge graph from documents");
    idx.add("d3", "reflection is a key mechanism in Self-RAG");
    const hits = idx.search("Self-RAG reflection");
    expect(hits.length).toBeGreaterThan(0);
    expect(["d1", "d3"]).toContain(hits[0].id);
    expect(hits.find((h) => h.id === "d2")).toBeUndefined();
  });

  it("中文查询可命中中文文档", () => {
    const idx = new BM25Index();
    idx.add("zh1", "知识图谱通过社区发现组织实体关系");
    idx.add("zh2", "向量检索基于语义相似度");
    const hits = idx.search("知识图谱 社区");
    expect(hits[0]?.id).toBe("zh1");
  });

  it("remove 后不再命中且统计一致", () => {
    const idx = new BM25Index();
    idx.add("a", "alpha beta");
    idx.add("b", "alpha gamma");
    idx.remove("a");
    expect(idx.size).toBe(1);
    const hits = idx.search("beta");
    expect(hits.length).toBe(0);
    expect(idx.search("alpha")[0].id).toBe("b");
  });

  it("无命中返回空数组", () => {
    const idx = new BM25Index();
    idx.add("x", "completely unrelated content");
    expect(idx.search("quantum entanglement")).toEqual([]);
  });
});
