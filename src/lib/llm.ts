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
  if (zhipu) return zhipu.chatModel(ZHIPU_CHAT_MODEL);
  if (deepseek) return deepseek.chatModel(DEEPSEEK_CHAT_MODEL);
  return mockChatModel();
}

/**
 * 轻量任务模型（打分/重写/抽取）：优先免费的 glm-4-flash 降本提速，无则回退主模型。
 */
export function fastModel(): LanguageModel {
  if (zhipu) return zhipu.chatModel("glm-4-flash");
  if (deepseek) return deepseek.chatModel(DEEPSEEK_CHAT_MODEL);
  return mockChatModel();
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
      const promptText = JSON.stringify(options.prompt).slice(0, 2000);
      if (promptText.includes("classify") || promptText.includes("复杂度")) {
        return {
          finishReason: "stop" as const,
          usage: { promptTokens: 10, completionTokens: 10 },
          rawCall: { rawPrompt: null, rawSettings: {} },
          text: JSON.stringify({
            complexity: "factual",
            reason: "[mock] 离线开发模式判定",
            strategy: "single-retrieval",
          }),
        };
      }
      return {
        finishReason: "stop" as const,
        usage: { promptTokens: 10, completionTokens: 10 },
        rawCall: { rawPrompt: null, rawSettings: {} },
        text: "【离线开发模式】当前未配置 LLM 密钥（.env.local 中的 ZHIPU_API_KEY / DEEPSEEK_API_KEY）。检索与图谱流水线已正常运行，配置密钥后即可获得真实生成能力。",
      };
    },
    async doStream(options: any) {
      const gen = await self.doGenerate(options);
      const text = gen.text;
      return {
        finishReason: "stop" as const,
        usage: { promptTokens: 10, completionTokens: 10 },
        rawCall: { rawPrompt: null, rawSettings: {} },
        stream: simulateReadableStream({
          chunkDelayInMs: 30,
          initialDelayInMs: 100,
          chunks: text.match(/[\u4e00-\u9fa5]{1,3}|\S+\s?|\s/g) ?? [text],
        }),
      };
    },
  };
  return self as unknown as LanguageModel;
}
