import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
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
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages: history.map((h) => ({ role: h.role, content: h.content })),
  });

  stream.on("text", (delta) => onDelta(delta));
  await stream.finalMessage();
}
