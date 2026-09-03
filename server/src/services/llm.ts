import { geminiProvider } from "./providers/gemini.js";
import { deepseekProvider } from "./providers/deepseek.js";
import type { ChatTurn, LlmProvider } from "./llmProvider.js";

export type { ChatTurn };

// Swap in another LlmProvider implementation here (and via LLM_PROVIDER) to
// change the model backing chat without touching routes/chat.ts.
const providers: Record<string, LlmProvider> = {
  gemini: geminiProvider,
  deepseek: deepseekProvider,
};

const activeProviderName = process.env.LLM_PROVIDER || "gemini";
const provider = providers[activeProviderName] ?? geminiProvider;

// Which env var each provider needs, so chat.ts can give a precise
// "you forgot to set X" message regardless of which provider is active.
const requiredEnvVar: Record<string, string> = {
  gemini: "GEMINI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
};

export function activeProviderMissingKey(): string | null {
  const envVar = requiredEnvVar[activeProviderName];
  return envVar && !process.env[envVar] ? envVar : null;
}

export function buildSystemPrompt(contextChunks: string[]): string {
  if (contextChunks.length === 0) {
    return "You are Jennysol, a helpful AI assistant. No documents have been uploaded yet, so answer from general knowledge and mention that uploading documents will let you ground answers in them.";
  }
  const context = contextChunks.map((c, i) => `[${i + 1}] ${c}`).join("\n\n");
  return [
    "You are Jennysol, a retrieval-augmented AI assistant.",
    "Answer the user's question using the CONTEXT below when it's relevant.",
    "If the context doesn't contain the answer, say so and answer from general knowledge instead of guessing.",
    "Cite context with bracketed numbers like [1] when you use it.",
    "",
    "CONTEXT:",
    context,
  ].join("\n");
}

export async function streamChatCompletion(
  systemPrompt: string,
  history: ChatTurn[],
  onDelta: (text: string) => void
): Promise<void> {
  await provider.streamChatCompletion(systemPrompt, history, onDelta);
}
