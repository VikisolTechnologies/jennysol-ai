import type { ChatTurn, StreamOptions } from "../llmProvider.js";

// Shared streaming client for any OpenAI-compatible chat completions endpoint
// (DeepSeek, Ollama, and most other providers all speak this same shape).
export async function streamOpenAiCompatible(
  url: string,
  headers: Record<string, string>,
  model: string,
  systemPrompt: string,
  history: ChatTurn[],
  onDelta: (text: string) => void,
  opts?: StreamOptions
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    signal: opts?.signal,
    body: JSON.stringify({
      model,
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        ...history.map((h) => ({ role: h.role, content: h.content })),
      ],
    }),
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    const err = new Error(`Request to ${url} failed (${res.status}): ${detail}`) as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const payload = line.replace(/^data: /, "").trim();
      if (!payload || payload === "[DONE]") continue;
      const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
      if (delta) onDelta(delta);
    }
  }
}
