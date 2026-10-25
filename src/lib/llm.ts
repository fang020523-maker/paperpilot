/**
 * LLM 接入层（刻意轻薄 —— 赛题要求后端仅作 AI 能力接入层）
 *
 * - 智谱 GLM（主）：OpenAI 兼容协议 https://open.bigmodel.cn/api/paas/v4
 * - DeepSeek（备用）：故障转移与 A/B 对比
 * - 无密钥开发模式：自动降级为本地确定性 mock，保证流水线可离线联调
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

export interface LlmStatus {
  primary: "zhipu" | "deepseek" | "mock";
  hasZhipu: boolean;
  hasDeepseek: boolean;
  chatModel: string;
  embeddingMode: "cloud" | "local";
  /** 用户原始配置（auto 表示智能选择） */
  embeddingModeRaw: string;
}

const ZHIPU_BASE = "https://open.bigmodel.cn/api/paas/v4";
const DEEPSEEK_BASE = "https://api.deepseek.com/v1";

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

export const zhipuKey = () => env("ZHIPU_API_KEY");
export const deepseekKey = () => env("DEEPSEEK_API_KEY");

export const ZHIPU_CHAT_MODEL = env("ZHIPU_CHAT_MODEL") ?? "glm-4.6";
export const ZHIPU_EMBEDDING_MODEL = env("ZHIPU_EMBEDDING_MODEL") ?? "embedding-3";
export const DEEPSEEK_CHAT_MODEL = env("DEEPSEEK_CHAT_MODEL") ?? "deepseek-chat";

/**
 * GLM-4.6/4.5 默认开启深度思考（reasoning_content），
 * Agent 多步场景每步都思考会显著拖慢且吞噬 max_tokens。
 * @ai-sdk/openai-compatible 会把 providerOptions[providerName] 透传进请求体，
 * 已实测：加此参数后 glm-4.6 直接输出内容、不再思考。
 */
export const NO_THINKING = {
  zhipu: { thinking: { type: "disabled" as const } },
} as const;

const zhipu =
  zhipuKey() &&
  createOpenAICompatible({
    name: "zhipu",
    baseURL: ZHIPU_BASE,
    apiKey: zhipuKey(),
  });

const deepseek =
  deepseekKey() &&
  createOpenAICompatible({
    name: "deepseek",
    baseURL: DEEPSEEK_BASE,
    apiKey: deepseekKey(),
  });

/**
 * 主生成模型：智谱优先，DeepSeek 兜底，无密钥时 mock（保证开箱可跑）。
 */
export function chatModel(preference?: "zhipu" | "deepseek"): LanguageModel {
  if (preference === "deepseek" && deepseek) return deepseek.chatModel(DEEPSEEK_CHAT_MODEL);
  if (preference === "zhipu" && zhipu) return zhipu.chatModel(ZHIPU_CHAT_MODEL);
  if (zhipu)
    // 主模型 4.6 触发限流时回退 flash（账号风控有粘性，flash 单发常可用）
    return withFallback(zhipu.chatModel(ZHIPU_CHAT_MODEL), zhipu.chatModel("glm-4-flash"));
  if (deepseek) return deepseek.chatModel(DEEPSEEK_CHAT_MODEL);
  return mockChatModel();
}

/**
 * 轻量任务模型（打分/重写/抽取）：优先免费的 glm-4-flash，账号级封禁/限流时自动回退 glm-4.6。
 */
export function fastModel(): LanguageModel {
  if (zhipu) {
    // 账号可能对特定子模型返回 1314/1113（如 flash 被锁而 4.6 可用），包装自动回退
    return withFallback(
      zhipu.chatModel("glm-4-flash"),
      zhipu.chatModel(ZHIPU_CHAT_MODEL)
    );
  }
  if (deepseek) return deepseek.chatModel(DEEPSEEK_CHAT_MODEL);
  return mockChatModel();
}

/**
 * 模型级回退包装：主模型请求失败（套餐/余额/限流类错误）时用备模型重试。
 * 带熔断：连续 2 次失败后 10 分钟冷却期内直接走备模型（避免每请求双倍延迟）。
 */
const FALLBACK_ERRORS = /1314|1113|1302|1305|429|rate|套餐|余额|速率/i;

function withFallback(primary: LanguageModel, fallback: LanguageModel): LanguageModel {
  const breaker = { fails: 0, openUntil: 0 };
  const primaryAllowed = () => breaker.openUntil < Date.now();
  const noteFail = () => {
    if (++breaker.fails >= 2) {
      breaker.openUntil = Date.now() + 10 * 60 * 1000;
      breaker.fails = 0;
      console.warn(`[llm] ${primary.modelId} 连续失败，熔断 10 分钟 → 直接使用 ${fallback.modelId}`);
    }
  };

  const self = {
    specificationVersion: "v1" as const,
    provider: "zhipu-fallback",
    modelId: `${primary.modelId}->${fallback.modelId}`,
    defaultObjectGenerationMode: "json" as const,
    async doGenerate(options: any) {
      if (primaryAllowed()) {
        try {
          return await primary.doGenerate(options);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!FALLBACK_ERRORS.test(msg)) throw err;
          noteFail();
        }
      }
      return fallback.doGenerate(options);
    },
    async doStream(options: any) {
      if (primaryAllowed()) {
        try {
          return await primary.doStream(options);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!FALLBACK_ERRORS.test(msg)) throw err;
          noteFail();
        }
      }
      return fallback.doStream(options);
    },
  };
  return self as unknown as LanguageModel;
}

export function llmStatus(): LlmStatus {
  const hasZhipu = !!zhipu;
  const hasDeepseek = !!deepseek;
  const mode = env("EMBEDDING_MODE") ?? "auto";
  return {
    primary: hasZhipu ? "zhipu" : hasDeepseek ? "deepseek" : "mock",
    hasZhipu,
    hasDeepseek,
    chatModel: hasZhipu ? ZHIPU_CHAT_MODEL : hasDeepseek ? DEEPSEEK_CHAT_MODEL : "mock-llm",
    embeddingMode: mode === "local" || !hasZhipu ? "local" : "cloud",
    embeddingModeRaw: mode,
  };
}

// ============ Mock 模型（离线开发联调用）============
// 实现 LanguageModel 的最小 doGenerate/doStream，返回确定性提示文本，
// 让全流水线在无任何密钥时依然可运行、可测试。

import { simulateReadableStream } from "ai";

function mockChatModel(): LanguageModel {
  const self = {
    specificationVersion: "v1" as const,
    provider: "mock",
    modelId: "mock-llm",
    defaultObjectGenerationMode: "json" as const,
    async doGenerate(options: any) {
      const promptText = JSON.stringify(options.prompt);
      let text: string;
      // 按调用场景返回可解析的 JSON（保证 generateObject 流水线离线可跑）
      if (promptText.includes("复杂度") || promptText.includes("classify")) {
        text = JSON.stringify({ complexity: "factual", reason: "[mock] 离线开发模式判定", strategy: "single-retrieval" });
      } else if (promptText.includes("忠实度") || promptText.includes("faithfulness")) {
        text = JSON.stringify({ faithfulness: 0.72, answerRelevancy: 0.75, contextPrecision: 0.65, contextRecall: 0.6, rationale: "[mock] 离线模式评分" });
      } else if (promptText.includes("实体类型说明") || promptText.includes("知识图谱构建器")) {
        text = JSON.stringify({ entities: [], relations: [] });
      } else if (promptText.includes("上下文定位说明")) {
        text = JSON.stringify({ contexts: ["[mock] 该片段出自论文正文，讨论方法与实验。"] });
      } else if (promptText.includes("书目元数据")) {
        // 返回空值让启发式抽取结果生效（保留真实标题/作者/arXiv号）
        text = JSON.stringify({ title: "", authors: [], year: null, venue: null, abstract: null });
      } else if (promptText.includes("查询优化器") || promptText.includes("假设性的答案")) {
        text = JSON.stringify({
          rewrittenQuery: "[mock] 原查询（离线模式未改写）",
          multiQueries: ["[mock] 视角一", "[mock] 视角二", "[mock] 视角三"],
          hypotheticalAnswer: "[mock] 离线模式下不生成假设答案内容。",
        });
      } else if (promptText.includes("相关性 0-10") || promptText.includes("支撑度")) {
        text = JSON.stringify({ score: 7, reason: "[mock] 离线模式默认中等相关", supportScore: 7, verdict: "[mock] 离线模式默认中等支撑" });
      } else if (promptText.includes("主题社区")) {
        text = "[mock] 离线模式下无法生成社区摘要：该社区围绕检索增强生成技术展开。";
      } else {
        text = "【离线开发模式】当前未配置 LLM 密钥（.env.local 中的 ZHIPU_API_KEY / DEEPSEEK_API_KEY）。检索、图谱与评估流水线已正常运行并返回结构化结果；配置密钥后重启即可获得真实的生成、改写与推理能力。";
      }
      return {
        finishReason: "stop" as const,
        usage: { promptTokens: 10, completionTokens: 10 },
        rawCall: { rawPrompt: null, rawSettings: {} },
        text,
      };
    },
    async doStream(options: any) {
      const gen = await self.doGenerate(options);
      const text = gen.text;
      const pieces = text.match(/[\u4e00-\u9fa5]{1,3}|\S+\s?|\s/g) ?? [text];
      return {
        finishReason: "stop" as const,
        usage: { promptTokens: 10, completionTokens: 10 },
        rawCall: { rawPrompt: null, rawSettings: {} },
        stream: simulateReadableStream({
          chunkDelayInMs: 30,
          initialDelayInMs: 100,
          chunks: pieces.map((p) => ({ type: "text-delta" as const, textDelta: p })),
        }),
      };
    },
  };
  return self as unknown as LanguageModel;
}
