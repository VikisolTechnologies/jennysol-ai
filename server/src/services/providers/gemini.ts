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
// without the tool and 429 with it, and Google takes ~15+ seconds to return
// that 429). Discovering that on a real user's message would tax every first
// request after a restart with a ~15s stall before falling back — measured
// directly (17s vs <1s). So availability is decided once, in the background,
// at module load — never inside a real request's critical path. Defaults to
// "off" until the probe proves otherwise, which is the safe direction to be
// wrong in (a slow-to-discover feature beats a slow first message).
let groundingAvailable = false;
let probeStarted = false;

function probeGroundingAvailability(): void {
  if (probeStarted) return;
  probeStarted = true;
  void (async () => {
    try {
      const stream = await getClient().models.generateContentStream(
        buildRequest("You are a helpful assistant.", [{ role: "user", content: "hi" }], true)
      );
      for await (const _chunk of stream) {
        // Draining is enough to know the tool-enabled request succeeded —
        // the content itself is discarded, this never reaches a real user.
      }
      groundingAvailable = true;
    } catch {
      groundingAvailable = false;
    }
  })();
}

export const geminiProvider: LlmProvider = {
  async streamChatCompletion(systemPrompt, history, onDelta, onWebSources) {
    probeGroundingAvailability();
    const tryWithSearch = groundingAvailable;
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

      if (onWebSources && grounding) {
        const sources = extractWebSources(grounding);
        if (sources.length > 0) onWebSources(sources);
      }
    } catch (err) {
      // Defense in depth: grounding looked available (probe succeeded, or
      // hasn't run yet) but this specific call still failed with nothing
      // streamed — fall back to plain chat rather than surfacing an error.
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
