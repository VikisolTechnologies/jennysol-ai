import type { LlmProvider } from "../llmProvider.js";
import { streamOpenAiCompatible } from "./openaiCompatible.js";

const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";

export const deepseekProvider: LlmProvider = {
  streamChatCompletion(systemPrompt, history, onDelta, _onWebSources, opts) {
    return streamOpenAiCompatible(
      "https://api.deepseek.com/chat/completions",
      { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
      MODEL,
      systemPrompt,
      history,
      onDelta,
      opts
    );
  },
};
