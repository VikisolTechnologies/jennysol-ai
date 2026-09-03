import { geminiProvider } from "./providers/gemini.js";
import { deepseekProvider } from "./providers/deepseek.js";
import { ollamaProvider } from "./providers/ollama.js";
import type { ChatTurn, LlmProvider } from "./llmProvider.js";

export type { ChatTurn };

// Swap in another LlmProvider implementation here (and via LLM_PROVIDER) to
// change the model backing chat without touching routes/chat.ts.
const providers: Record<string, LlmProvider> = {
  gemini: geminiProvider,
  deepseek: deepseekProvider,
  ollama: ollamaProvider,
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

const PERSONA = [
  "You are Jennysol, a warm, sharp, conversational AI assistant — talk like a knowledgeable",
  "person explaining something to a friend, not like a manual. Use plain language and",
  "contractions, get to the point, and vary sentence length like real speech does. Avoid",
  "stiff transitions (\"Furthermore,\" \"It is important to note that\"), avoid restating the",
  "question back before answering it, and don't hedge with disclaimers unless they're",
  "actually load-bearing. When something is genuinely complex, walk through it the way a",
  "good teacher would — plain terms first, then precision — rather than dumping a dense",
  "technical wall of text.",
].join(" ");

export function buildSystemPrompt(contextChunks: string[]): string {
  if (contextChunks.length === 0) {
    return `${PERSONA} No documents have been uploaded yet, so answer from general knowledge — mention once, naturally, that uploading documents would let you ground answers in them, but don't belabor it.`;
  }
  const context = contextChunks.map((c, i) => `[${i + 1}] ${c}`).join("\n\n");
  return [
    PERSONA,
    "",
    "Answer the user's question using the CONTEXT below when it's relevant.",
    "If the context doesn't contain the answer, say so plainly and answer from general",
    "knowledge instead of guessing. Cite context with bracketed numbers like [1] when you",
    "use it, but weave the citation in naturally rather than tacking it on awkwardly.",
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
