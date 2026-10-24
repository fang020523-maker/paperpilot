import { generateObject } from "ai";
import { z } from "zod";
import { fastModel } from "@/lib/llm";

export const maxDuration = 60;

/**
 * POST /api/evaluate — RAGAS 风格 LLM-as-a-judge 评估（arXiv:2309.15217 思想的轻量化实现）
 * Body: { question, answer, contexts: string[], pipeline: 'agentic' | 'naive', latencyMs? }
 */
const ScoreSchema = z.object({
  faithfulness: z.number().min(0).max(1),
  answerRelevancy: z.number().min(0).max(1),
  contextPrecision: z.number().min(0).max(1),
  contextRecall: z.number().min(0).max(1),
  rationale: z.string().max(400),
});

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
  const contexts = (body.contexts ?? []).slice(0, 8);
  const contextText = contexts.map((c, i) => `[${i + 1}] ${c.slice(0, 700)}`).join("\n\n");

  try {
    const { object } = await generateObject({
      model: fastModel(),
      schema: ScoreSchema,
      prompt: `你是 RAG 系统质量评估器（RAGAS 方法论）。依据以下定义逐项打分（0.0-1.0，可一位小数）：

1. faithfulness（忠实度）：答案中的论断被【检索上下文】直接支撑的比例。答案包含上下文中没有的编造事实时显著降低。
2. answerRelevancy（答案相关性）：答案是否切题且完整地回应了【问题】。答非所问、过度冗余、该拒答而未拒答时降低。
3. contextPrecision（上下文精确率）：【检索上下文】中对回答真正有用的比例。大量无关片段时降低。
4. contextRecall（上下文召回率）：回答问题所需的信息在【检索上下文】中被覆盖的程度。明显缺失关键证据时降低。

【问题】${body.question}

【检索上下文】
${contextText || "（空——若答案正确拒答，faithfulness 给高分；否则低分）"}

【系统的回答】
${body.answer.slice(0, 3000)}

输出四项分数与一句话 rationale（中文）。`,
    });

    return Response.json({
      ...object,
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
