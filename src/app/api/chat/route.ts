import { streamText, convertToCoreMessages, type Message } from "ai";
import { chatModel } from "@/lib/llm";
import {
  AGENT_SYSTEM_PROMPT,
  buildAgentTools,
  sanitizeContext,
  type RequestContext,
} from "@/lib/agents/tools";

export const maxDuration = 120;

export async function POST(req: Request) {
  const body = (await req.json()) as {
    messages: Message[];
    pipeline?: "agentic" | "naive" | "privacy";
    /** 隐私模式：端侧检索完成的上下文（仅片段上云） */
    contexts?: { paperTitle: string; page: number; text: string }[];
  };
  const messages = convertToCoreMessages(body.messages);
  const pipeline = body.pipeline ?? "agentic";
  const model = chatModel();

  // ============ Naive 基线（单轮向量 RAG，供 A/B 对比）============
  if (pipeline === "naive") {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const question =
      typeof lastUser?.content === "string" ? lastUser.content : JSON.stringify(lastUser?.content);
    const kb = (await import("@/lib/kb/store")).getKB();
    await kb.ensureLoaded();
    const { getEmbeddingChannel } = await import("@/lib/embeddings");
    let contextText = "";
    try {
      const channel = await getEmbeddingChannel();
      const [emb] = await channel.embed([question], "query");
      const chunks = kb.vectorSearch(emb, 5);
      contextText = chunks
        .map(
          (c, i) =>
            `[${i + 1}] ${kb.papers.get(c.paperId)?.title ?? ""} (第${c.page}页)\n${c.text.slice(0, 800)}`
        )
        .join("\n\n");
    } catch {
      contextText = "";
    }
    const result = streamText({
      model,
      system: `你是学术文献问答助手（朴素 RAG 基线模式）。基于以下检索片段回答，用 [n] 标注引用；证据不足时明确说明。\n\n检索片段：\n${contextText || "（无检索结果）"}`,
      messages,
    });
    return result.toDataStreamResponse();
  }

  // ============ 隐私模式（端侧检索 + 片段脱敏上云生成）============
  if (pipeline === "privacy") {
    const ctx = (body.contexts ?? []).slice(0, 6);
    const contextText = ctx
      .map((c, i) => `[${i + 1}] ${c.paperTitle} (第${c.page}页)\n${sanitizeContext(c.text)}`)
      .join("\n\n");
    const result = streamText({
      model,
      system: `你是学术文献问答助手（端侧隐私模式：检索已在用户浏览器内完成，以下片段是唯一依据）。
基于片段用中文回答并以 [n] 标注引用；片段不足以回答时明确说明"本地检索未找到充分依据"，不得编造。

检索片段：
${contextText || "（无检索结果）"}`,
      messages,
    });
    return result.toDataStreamResponse();
  }

  // ============ Agentic 主流水线 ============
  const requestCtx: RequestContext = { lastRetrieved: [], retrievalRounds: 0 };
  const tools = buildAgentTools(requestCtx);

  const result = streamText({
    model,
    system: AGENT_SYSTEM_PROMPT,
    messages,
    tools,
    maxSteps: 10,
  });

  return result.toDataStreamResponse();
}
