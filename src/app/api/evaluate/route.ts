import { ragasEvaluate } from "@/lib/eval/ragas";

export const maxDuration = 60;

/**
 * POST /api/evaluate — RAGAS 四指标 LLM-as-a-judge（对话后异步评分）
 */
export async function POST(req: Request) {
  const body = (await req.json()) as {
    question: string;
    answer: string;
    contexts: string[];
    pipeline?: "agentic" | "naive";
    latencyMs?: number;
  };

  if (!body.question || !body.answer) {
    return Response.json({ error: "缺少 question 或 answer" }, { status: 400 });
  }

  try {
    const scores = await ragasEvaluate({
      question: body.question,
      answer: body.answer,
      contexts: body.contexts ?? [],
    });
    return Response.json({
      ...scores,
      latencyMs: body.latencyMs ?? null,
      pipeline: body.pipeline ?? "agentic",
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "评估失败" },
      { status: 500 }
    );
  }
}
