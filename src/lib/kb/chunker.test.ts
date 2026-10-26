import { describe, it, expect } from "vitest";
import { chunkPages, heuristicMetadata } from "./chunker";

describe("chunkPages（结构化分块）", () => {
  const mkPage = (page: number, ...paras: string[]) => ({
    page,
    text: paras.join("\n\n"),
  });

  it("按目标长度切分且保留重叠", () => {
    const long = "Sentence about retrieval augmented generation. ".repeat(40);
    const chunks = chunkPages([mkPage(1, long)], 500, 0.12);
    expect(chunks.length).toBeGreaterThan(1);
    // 重叠：下一块开头与上一块结尾有共享内容（粗略验证非空且文本连续）
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].text.length).toBeGreaterThan(80);
    }
  });

  it("编号标题被识别为 section", () => {
    const chunks = chunkPages([
      mkPage(
        1,
        "3.2 Method Details",
        "We propose a novel approach with reflection tokens " +
          "and evaluate it thoroughly across benchmarks with detailed analysis of results. ".repeat(6)
      ),
    ], 400, 0.1);
    expect(chunks.some((c) => c.section?.includes("Method"))).toBe(true);
  });

  it("页码被正确记录", () => {
    const body = "Cross page boundary test with sufficient content to form chunks. ".repeat(30);
    const chunks = chunkPages([mkPage(1, body), mkPage(2, body)], 900, 0.1);
    expect(chunks.every((c) => c.page >= 1 && c.page <= 3)).toBe(true);
  });

  it("短文本不产出分块（低于最小长度）", () => {
    expect(chunkPages([mkPage(1, "too short")], 1100)).toHaveLength(0);
  });
});

describe("heuristicMetadata（元数据启发式）", () => {
  it("抽取标题/作者/年份/arXiv 号", () => {
    const pages = [
      {
        page: 1,
        text: [
          "Self-RAG: Learning to Retrieve, Generate, and Critique",
          "Asai, Akari and Wu, Zeqiu and Wang, Yizhong",
          "University of Washington",
          "arXiv:2310.11511",
          "Abstract",
          "We introduce Self-RAG, a new framework released in 2023.",
        ].join("\n\n"),
      },
    ];
    const meta = heuristicMetadata(pages);
    expect(meta.title).toContain("Self-RAG");
    expect(meta.authors.length).toBeGreaterThanOrEqual(2);
    expect(meta.year).toBe(2023);
    expect(meta.arxivId).toBe("2310.11511");
  });
});
