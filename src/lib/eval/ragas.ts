/**
 * RAGAS 风格 LLM-as-a-judge 评估器（arXiv:2309.15217 思想）
 * 被 /api/evaluate（对话后异步评分）与 /api/benchmark（批量对比实验）共用。
 */
import { generateObject } from "ai";
import { z } from "zod";
import { fastModel } from "../llm";

const ScoreSchema = z.object({
  faithfulness: z.number().min(0).max(1),
  answerRelevancy: z.number().min(0).max(1),
  contextPrecision: z.number().min(0).max(1),
  contextRecall: z.number().min(0).max(1),
  rationale: z.string().max(400),
});

export interface RagasInput {
  question: string;
  answer: string;
  contexts: string[];
}

export async function ragasEvaluate(input: RagasInput): Promise<{
  faithfulness: number;
  answerRelevancy: number;
  contextPrecision: number;
  contextRecall: number;
  rationale: string;
}> {
  const contexts = (input.contexts ?? []).slice(0, 8);
  const contextText = contexts.map((c, i) => `[${i + 1}] ${c.slice(0, 700)}`).join("\n\n");

  const { object } = await generateObject({
    model: fastModel(),
    schema: ScoreSchema,
    prompt: `你是 RAG 系统质量评估器（RAGAS 方法论）。依据以下定义逐项打分（0.0-1.0，可一位小数）：

1. faithfulness（忠实度）：答案中的论断被【检索上下文】直接支撑的比例。答案包含上下文中没有的编造事实时显著降低。
2. answerRelevancy（答案相关性）：答案是否切题且完整地回应了【问题】。答非所问、过度冗余、该拒答而未拒答时降低。
3. contextPrecision（上下文精确率）：【检索上下文】中对回答真正有用的比例。大量无关片段时降低。
4. contextRecall（上下文召回率）：回答问题所需的信息在【检索上下文】中被覆盖的程度。明显缺失关键证据时降低。

【问题】${input.question}

【检索上下文】
${contextText || "（空——若答案正确拒答，faithfulness 给高分；否则低分）"}

【系统的回答】
${input.answer.slice(0, 3000)}

输出四项分数与一句话 rationale（中文）。`,
  });
  return object;
}
