import { generateText } from "ai";
import { chatModel } from "@/lib/llm";
import { AGENT_SYSTEM_PROMPT, buildAgentTools } from "@/lib/agents/tools";
import { ragasEvaluate } from "@/lib/eval/ragas";
import { getKB } from "@/lib/kb/store";
import { getEmbeddingChannel } from "@/lib/embeddings";

export const maxDuration = 600;

/**
 * POST /api/benchmark — 一键对比实验（Naive RAG vs Agentic RAG）
 *
 * 对预设问题集分别运行两条管线并逐题 RAGAS 评分，
 * SSE 实时返回每题结果 —— 用系统自身产出的量化数据证明 Agentic 增益。
 */
const QUESTIONS = [
  "Self-RAG 使用什么机制来决定何时检索？",
  "CRAG 在检索质量不佳时会采取什么纠正措施？",
  "Adaptive-RAG 如何针对不同复杂度的问题选择策略？",
  "GraphRAG 的全局搜索和局部搜索分别解决什么问题？",
  "RAGAS 评估框架包含哪些核心指标？",
  "RAPTOR 通过什么结构来组织文档层次？",
];

type BenchEvent =
  | { type: "progress"; question: string; pipeline: "naive" | "agentic"; stage: "answering" | "evaluating"; index: number; total: number }
  | { type: "result"; index: number; pipeline: "naive" | "agentic"; question: string; answerPreview: string; latencyMs: number; scores: Record<string, number> }
  | { type: "done"; summary: Record<string, { faithfulness: number; answerRelevancy: number; contextPrecision: number; contextRecall: number; count: number }> }
  | { type: "error"; message: string };

export async function POST() {
  const kb = getKB();
  await kb.ensureLoaded();
  if (kb.chunks.size === 0) {
    return Response.json({ error: "知识库为空，请先导入文献" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: BenchEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      };
      const results: { pipeline: "naive" | "agentic"; scores: Record<string, number> }[] = [];

      try {
        for (let i = 0; i < QUESTIONS.length; i++) {
          const q = QUESTIONS[i];

          // ---------- Naive 管线 ----------
          send({ type: "progress", question: q, pipeline: "naive", stage: "answering", index: i, total: QUESTIONS.length });
          let naiveAnswer = "";
          let naiveContexts: string[] = [];
          const t0 = Date.now();
          try {
            const channel = await getEmbeddingChannel();
            const [emb] = await channel.embed([q], "query");
            const chunks = kb.vectorSearch(emb, 5);
            naiveContexts = chunks.map((c) => c.text);
            const naiveCtx = chunks
              .map((c, j) => `[${j + 1}] ${kb.papers.get(c.paperId)?.title ?? ""} (第${c.page}页)\n${c.text.slice(0, 800)}`)
              .join("\n\n");
            const { text } = await generateText({
              model: chatModel(),
              system: `你是学术文献问答助手（朴素 RAG 基线）。基于以下片段回答并用 [n] 标注引用，证据不足时明确说明。\n\n${naiveCtx}`,
              prompt: q,
            });
            naiveAnswer = text;
          } catch (err) {
            naiveAnswer = `（基线管线执行失败：${err instanceof Error ? err.message.slice(0, 80) : "未知错误"}）`;
          }
          const naiveLatency = Date.now() - t0;
          send({ type: "progress", question: q, pipeline: "naive", stage: "evaluating", index: i, total: QUESTIONS.length });
          let naiveScores: Record<string, number> = { faithfulness: 0, answerRelevancy: 0, contextPrecision: 0, contextRecall: 0 };
          try {
            const s = await ragasEvaluate({ question: q, answer: naiveAnswer, contexts: naiveContexts });
            naiveScores = { faithfulness: s.faithfulness, answerRelevancy: s.answerRelevancy, contextPrecision: s.contextPrecision, contextRecall: s.contextRecall };
          } catch { /* 保留零分 */ }
          results.push({ pipeline: "naive", scores: naiveScores });
          send({ type: "result", index: i, pipeline: "naive", question: q, answerPreview: naiveAnswer.slice(0, 120), latencyMs: naiveLatency, scores: naiveScores });

          // ---------- Agentic 管线 ----------
          send({ type: "progress", question: q, pipeline: "agentic", stage: "answering", index: i, total: QUESTIONS.length });
          const agentCtx = { lastRetrieved: [] as import("@/lib/types").RetrievedChunk[], retrievalRounds: 0 };
          const tools = buildAgentTools(agentCtx);
          let agenticAnswer = "";
          const t1 = Date.now();
          try {
            const { text } = await generateText({
              model: chatModel(),
              system: AGENT_SYSTEM_PROMPT,
              prompt: q,
              tools,
              maxSteps: 10,
            });
            agenticAnswer = text;
          } catch (err) {
            agenticAnswer = `（Agentic 管线执行失败：${err instanceof Error ? err.message.slice(0, 80) : "未知错误"}）`;
          }
          // 评估上下文 = 本次流水线最后一轮检索命中的分块（共享上下文累加器）
          const agenticContexts = agentCtx.lastRetrieved.map((r) => r.chunk.text);
          const agenticLatency = Date.now() - t1;
          send({ type: "progress", question: q, pipeline: "agentic", stage: "evaluating", index: i, total: QUESTIONS.length });
          let agenticScores: Record<string, number> = { faithfulness: 0, answerRelevancy: 0, contextPrecision: 0, contextRecall: 0 };
          try {
            const s = await ragasEvaluate({ question: q, answer: agenticAnswer, contexts: agenticContexts });
            agenticScores = { faithfulness: s.faithfulness, answerRelevancy: s.answerRelevancy, contextPrecision: s.contextPrecision, contextRecall: s.contextRecall };
          } catch { /* 保留零分 */ }
          results.push({ pipeline: "agentic", scores: agenticScores });
          send({ type: "result", index: i, pipeline: "agentic", question: q, answerPreview: agenticAnswer.slice(0, 120), latencyMs: agenticLatency, scores: agenticScores });
        }

        // ---------- 汇总 ----------
        const summarize = (pipe: "naive" | "agentic") => {
          const rs = results.filter((r) => r.pipeline === pipe);
          const avg = (k: string) =>
            rs.length ? Number((rs.reduce((s, r) => s + (r.scores[k] ?? 0), 0) / rs.length).toFixed(3)) : 0;
          return {
            faithfulness: avg("faithfulness"),
            answerRelevancy: avg("answerRelevancy"),
            contextPrecision: avg("contextPrecision"),
            contextRecall: avg("contextRecall"),
            count: rs.length,
          };
        };
        send({ type: "done", summary: { naive: summarize("naive"), agentic: summarize("agentic") } });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : "对比实验失败" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
