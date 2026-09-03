import type { LlmProvider } from "../llmProvider.js";
import { streamOpenAiCompatible } from "./openaiCompatible.js";

// Ollama runs locally — this points at wherever Ollama is actually reachable
// from this server process, not at the user's own machine. On a cloud host
// (Railway etc.) that means an Ollama instance you're running and exposing
// yourself; there's no cloud-hosted Ollama to fall back to.
const BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const MODEL = process.env.OLLAMA_MODEL || "llama3.2";

export const ollamaProvider: LlmProvider = {
  streamChatCompletion(systemPrompt, history, onDelta) {
    return streamOpenAiCompatible(`${BASE_URL}/v1/chat/completions`, {}, MODEL, systemPrompt, history, onDelta);
  },
};
