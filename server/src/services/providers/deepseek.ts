import type { LlmProvider } from "../llmProvider.js";

const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";

export const deepseekProvider: LlmProvider = {
  async streamChatCompletion(systemPrompt, history, onDelta) {
    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        messages: [
          { role: "system", content: systemPrompt },
          ...history.map((h) => ({ role: h.role, content: h.content })),
        ],
      }),
    });

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      const err = new Error(`DeepSeek request failed (${res.status}): ${detail}`) as Error & {
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
  },
};
