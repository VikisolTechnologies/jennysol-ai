import { GoogleGenAI } from "@google/genai";
import type { ChatTurn, LlmProvider } from "../llmProvider.js";

const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

export const geminiProvider: LlmProvider = {
  async streamChatCompletion(systemPrompt, history, onDelta) {
    const stream = await getClient().models.generateContentStream({
      model: MODEL,
      contents: history.map((h) => ({
        role: h.role === "assistant" ? "model" : "user",
        parts: [{ text: h.content }],
      })),
      config: { systemInstruction: systemPrompt },
    });

    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) onDelta(text);
    }
  },
};

export type { ChatTurn };
