import { GoogleGenAI } from "@google/genai";
import type { ChatTurn, LlmProvider, WebSource } from "../llmProvider.js";

const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

function buildRequest(systemPrompt: string, history: ChatTurn[], withSearch: boolean) {
  return {
    model: MODEL,
    contents: history.map((h) => ({
      role: h.role === "assistant" ? "model" : "user",
      parts: [{ text: h.content }],
    })),
    config: {
      systemInstruction: systemPrompt,
      // Gemini decides per-turn whether a query actually needs a search —
      // declaring the tool doesn't force one on every message. Grounding
      // chunks arrive with real title/uri/domain, so sources shown to the
      // user are never fabricated.
      ...(withSearch ? { tools: [{ googleSearch: {} }] } : {}),
    },
  };
}

// Some API keys/tiers reject the googleSearch tool outright (a separate quota
// bucket from plain chat — empirically confirmed: identical requests succeed
// without the tool and 429 with it). Once that's observed, stop attempting it
// so every subsequent message doesn't pay for a doomed round trip; plain chat
// keeps working either way. Not persisted — a fresh process re-probes once.
let groundingAvailable: boolean | null = null;

export const geminiProvider: LlmProvider = {
  async streamChatCompletion(systemPrompt, history, onDelta, onWebSources) {
    const tryWithSearch = groundingAvailable !== false;
    let deltasSent = 0;

    try {
      const stream = await getClient().models.generateContentStream(
        buildRequest(systemPrompt, history, tryWithSearch)
      );

      // groundingMetadata is only populated on later chunks (often the last
      // one), so keep the latest value seen rather than the first.
      let grounding: unknown;
      for await (const chunk of stream) {
        const text = chunk.text;
        if (text) {
          onDelta(text);
          deltasSent++;
        }
        const md = chunk.candidates?.[0]?.groundingMetadata;
        if (md) grounding = md;
      }

      if (tryWithSearch) groundingAvailable = true;
      if (onWebSources && grounding) {
        const sources = extractWebSources(grounding);
        if (sources.length > 0) onWebSources(sources);
      }
    } catch (err) {
      // Grounding unavailable on this key/tier and nothing was streamed yet —
      // fall back to plain chat for this same request rather than surfacing
      // an error the user never should have seen.
      if (tryWithSearch && deltasSent === 0) {
        groundingAvailable = false;
        const stream = await getClient().models.generateContentStream(
          buildRequest(systemPrompt, history, false)
        );
        for await (const chunk of stream) {
          const text = chunk.text;
          if (text) onDelta(text);
        }
        return;
      }
      throw err;
    }
  },
};

function extractWebSources(groundingMetadata: unknown): WebSource[] {
  const chunks = (groundingMetadata as { groundingChunks?: { web?: { uri?: string; title?: string; domain?: string } }[] })
    .groundingChunks;
  if (!chunks) return [];
  const seen = new Set<string>();
  const sources: WebSource[] = [];
  for (const chunk of chunks) {
    const web = chunk.web;
    if (!web?.uri || seen.has(web.uri)) continue;
    seen.add(web.uri);
    sources.push({ title: web.title || web.uri, url: web.uri, domain: web.domain });
  }
  return sources;
}

export type { ChatTurn };
