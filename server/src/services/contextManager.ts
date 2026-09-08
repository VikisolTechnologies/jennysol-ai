import type { ChatTurn, WebSource } from "./llmProvider.js";
import { embed } from "./embeddings.js";
import { searchSimilarChunks, userHasDocuments } from "./vectorStore.js";
import { getConversationSummary, saveConversationSummary } from "./conversationStore.js";
import { routeChatCompletion } from "./modelRouter.js";
import { needsCurrentInfo } from "./currentInfo.js";
import { search as runWebSearch, hasAnySearchProviderConfigured } from "./search/searchRouter.js";
import { isWeatherQuestion, extractLocationFromMessage } from "./weather/weatherIntent.js";
import { getWeather } from "./weather/weatherProvider.js";

// How many of the most recent raw messages get sent to the model verbatim.
// Everything older than this is represented by a rolling summary instead —
// this is the fix for the confirmed root cause of latency growing with
// conversation length (JENNY_RESPONSE_LATENCY_AUDIT.md): the full transcript
// was being resent, unbounded, on every single turn.
const RECENT_WINDOW = Number(process.env.CONTEXT_RECENT_WINDOW) || 12;

// Only re-summarize once the unsummarized gap has grown by this many
// messages, not on every single message past the window — summarizing is
// itself a full model call, so batching keeps that overhead to roughly one
// extra call per N messages instead of doubling every request's LLM cost.
const SUMMARY_BATCH_SIZE = Number(process.env.CONTEXT_SUMMARY_BATCH) || 5;

// Messages this trivial never benefit from document retrieval — skipping
// embed() + searchSimilarChunks for them avoids paying for a local ONNX
// inference pass and a chunk scan that could never change the answer.
const TRIVIAL_MESSAGE_PATTERN =
  /^(hi|hello|hey|yo+|sup|hiya|good\s?(morning|afternoon|evening|night)|how'?s it going|how are you( doing)?|what'?s up|thanks|thank you|ok|okay|cool|nice|great|bye|goodbye|see ya|sup jenny|hi jenny|hello jenny)[\s!.?]*$/i;

export interface DocumentMatch {
  documentId: string;
  text: string;
}

export interface BuiltContext {
  turns: ChatTurn[];
  retrievalSkipped: boolean;
  documentMatches: DocumentMatch[];
  // Live web results, retrieved once here — before any model is chosen —
  // and handed to whichever provider ends up answering as plain context
  // text, the same way document RAG already works. This is what makes
  // current-info answers provider-independent: Gemini, DeepSeek, and Ollama
  // all receive the identical injected results, none of them needs its own
  // search integration.
  webChunks: string[];
  webSources: WebSource[];
  // Non-null only when this turn (or the immediately preceding one — see
  // retrieveWeatherContext's two-turn "how's weather" -> "I'm in Guntur"
  // handling) is actually about weather AND a location could be resolved.
  // Free/no-key (Open-Meteo — see weather/weatherProvider.ts), so this never
  // gates on any configured() check the way search/image do.
  weatherChunk: string | null;
}

function boundedHistory(userId: string, conversationId: string, fullHistory: ChatTurn[]): ChatTurn[] {
  if (fullHistory.length <= RECENT_WINDOW) return fullHistory;

  const recent = fullHistory.slice(-RECENT_WINDOW);
  const olderCount = fullHistory.length - RECENT_WINDOW;
  const { summary, throughIndex } = getConversationSummary(userId, conversationId);

  // Anything the summarizer hasn't caught up to yet is sent raw rather than
  // silently dropped — the summary is purely a latency/cost optimization,
  // never a place real content is allowed to go missing. summarizeIfNeeded
  // (fired after this request's own response finishes) closes this gap over
  // the next few turns.
  const gap = fullHistory.slice(Math.min(throughIndex, olderCount), olderCount);

  const turns: ChatTurn[] = [];
  if (summary) {
    turns.push({ role: "user", content: `[Summary of earlier conversation]\n${summary}` });
    turns.push({ role: "assistant", content: "Got it — I'll keep that context in mind." });
  }
  turns.push(...gap, ...recent);
  return turns;
}

async function retrieveDocuments(
  userId: string,
  message: string
): Promise<{ skipped: boolean; matches: DocumentMatch[] }> {
  if (TRIVIAL_MESSAGE_PATTERN.test(message.trim())) return { skipped: true, matches: [] };
  if (!userHasDocuments(userId)) return { skipped: true, matches: [] };

  const queryEmbedding = await embed(message);
  const matches = searchSimilarChunks(userId, queryEmbedding, 5);
  return { skipped: false, matches: matches.map((m) => ({ documentId: m.documentId, text: m.text })) };
}

// Only spends a real search API call when the question actually looks
// time-sensitive (needsCurrentInfo) AND a search provider is actually
// configured — with neither, this resolves instantly to "nothing available"
// and the persona (see llm.ts) is what keeps the model from guessing a
// current fact it doesn't have. When Gemini ends up being the provider that
// answers and no external search is configured, its own native grounding
// tool remains the fallback mechanism (see gemini.ts) — this function only
// ever returns non-empty when an external provider is actually configured,
// so the two paths never both fire for the same turn.
async function retrieveWebContext(message: string): Promise<{ chunks: string[]; sources: WebSource[] }> {
  if (!needsCurrentInfo(message)) return { chunks: [], sources: [] };
  if (!hasAnySearchProviderConfigured()) return { chunks: [], sources: [] };

  const outcome = await runWebSearch(message);
  if (!outcome || outcome.results.length === 0) return { chunks: [], sources: [] };

  return {
    chunks: outcome.results.map((r) => `${r.title} (${r.url}): ${r.snippet}`),
    sources: outcome.results.map((r) => ({ title: r.title, url: r.url, domain: r.domain })),
  };
}

// Handles the real, confirmed-in-production two-turn case: "How's weather"
// (no location given) followed by "Am in Guntur can u please check" (no
// weather keyword at all in this turn, just a location statement replying
// to the assistant's implicit "where are you?"). Only looks one user-turn
// back — deliberately shallow, matching this codebase's existing
// "detectable signal, not invented inference" philosophy (see
// modelRegistry.ts's classifyTask comment).
async function retrieveWeatherContext(
  message: string,
  fullHistory: ChatTurn[]
): Promise<{ weatherChunk: string | null }> {
  const weatherIntentNow = isWeatherQuestion(message);
  const lastUserMessage = weatherIntentNow
    ? undefined
    : [...fullHistory].reverse().find((t) => t.role === "user")?.content;
  const isLocationReplyToPendingWeatherQuestion =
    !weatherIntentNow && !!lastUserMessage && isWeatherQuestion(lastUserMessage);

  if (!weatherIntentNow && !isLocationReplyToPendingWeatherQuestion) return { weatherChunk: null };

  const location = extractLocationFromMessage(message);
  // No location found — leave it to the model/persona to ask for one, same
  // honest behavior as before this capability existed. Never guess a city.
  if (!location) return { weatherChunk: null };

  const result = await getWeather(location);
  if (!result) {
    return {
      weatherChunk: `[Live weather lookup for "${location}" failed — tell the user plainly that live weather is temporarily unavailable right now. Never guess or invent a temperature/condition.]`,
    };
  }

  return {
    weatherChunk: [
      `LIVE WEATHER DATA for ${result.resolvedLocation} (source: Open-Meteo, observed ${result.observedAt}):`,
      `- Condition: ${result.conditionText}`,
      `- Temperature: ${result.temperatureC}°C (feels like ${result.feelsLikeC}°C)`,
      `- Humidity: ${result.humidityPercent}%`,
      `- Wind: ${result.windKph} km/h`,
      `- Precipitation: ${result.precipitationMm} mm`,
      "State these exact figures as the current weather — never invent or adjust them.",
    ].join("\n"),
  };
}

export async function buildContext(
  userId: string,
  conversationId: string,
  message: string,
  fullHistory: ChatTurn[]
): Promise<BuiltContext> {
  const historyTurns = boundedHistory(userId, conversationId, fullHistory);
  const [retrieval, webContext, weather] = await Promise.all([
    retrieveDocuments(userId, message),
    retrieveWebContext(message),
    retrieveWeatherContext(message, fullHistory),
  ]);

  return {
    turns: [...historyTurns, { role: "user", content: message }],
    retrievalSkipped: retrieval.skipped,
    documentMatches: retrieval.matches,
    webChunks: webContext.chunks,
    webSources: webContext.sources,
    weatherChunk: weather.weatherChunk,
  };
}

const SUMMARY_PROMPT = [
  "Summarize the key facts, decisions, and context from this conversation so far in under 150 words.",
  "Write it as plain prose a future assistant can quickly read to understand what's been discussed so far.",
  "Do not include meta-commentary, headers, or bullet points — just the summary itself as flowing prose.",
].join(" ");

// Fire-and-forget: called after a run's own response has already been sent
// to the user. Must never be awaited by the request that triggered it — the
// entire point of bounding history is to keep the hot path fast, and
// generating a summary is itself a full model call. A failed summarization
// just means the next message resends a slightly larger raw gap; nothing is
// lost or corrupted.
export function summarizeIfNeeded(userId: string, conversationId: string, fullHistory: ChatTurn[]): void {
  if (fullHistory.length <= RECENT_WINDOW) return;
  const olderCount = fullHistory.length - RECENT_WINDOW;
  const { throughIndex, summary: previousSummary } = getConversationSummary(userId, conversationId);
  if (olderCount - throughIndex < SUMMARY_BATCH_SIZE) return;

  void (async () => {
    try {
      const olderMessages = fullHistory.slice(0, olderCount);
      const transcript = olderMessages.map((m) => `${m.role}: ${m.content}`).join("\n");
      let newSummary = "";
      await routeChatCompletion(
        SUMMARY_PROMPT,
        [
          ...(previousSummary
            ? [{ role: "user" as const, content: `Previous summary: ${previousSummary}` }]
            : []),
          { role: "user" as const, content: `Conversation transcript to fold in:\n${transcript}` },
        ],
        (delta) => {
          newSummary += delta;
        }
      );
      if (newSummary.trim()) saveConversationSummary(userId, conversationId, newSummary.trim(), olderCount);
    } catch (err) {
      console.error(
        "[contextManager] background summarization failed (non-fatal):",
        err instanceof Error ? err.message : err
      );
    }
  })();
}
