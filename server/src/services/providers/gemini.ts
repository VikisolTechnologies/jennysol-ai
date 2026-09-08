import { GoogleGenAI } from "@google/genai";
import type { ChatTurn, LlmProvider, WebSource } from "../llmProvider.js";
import { needsCurrentInfo } from "../currentInfo.js";
import { hasAnySearchProviderConfigured } from "../search/searchRouter.js";

const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

function buildRequest(systemPrompt: string, history: ChatTurn[], withSearch: boolean, signal?: AbortSignal) {
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
      // Client-side only (the SDK's own docs are explicit: aborting here
      // stops us from waiting on / billing our own downstream handling of
      // the response, but does not cancel the request inside Google's
      // service — a hedge "loser" or a timed-out attempt may still be
      // metered upstream even after this fires).
      ...(signal ? { abortSignal: signal } : {}),
    },
  };
}

// Some API keys/tiers reject the googleSearch tool outright (a separate quota
// bucket from plain chat — empirically confirmed: identical requests succeed
// without the tool and 429 with it, and Google takes ~15+ seconds to return
// that 429). Discovering that on a real user's message would tax every first
// request after a restart with a ~15s stall before falling back — measured
// directly (17s vs <1s). So availability is decided once, in the background,
// never inside a real request's critical path. Defaults to "off" until the
// probe proves otherwise, which is the safe direction to be wrong in (a
// slow-to-discover feature beats a slow first message).
//
// This used to be triggered lazily, from inside the first real
// streamChatCompletion call. That kept it off the *critical path* (it was
// never awaited), but it still meant the very first real user request after
// a restart ran concurrently with this ~15s background probe — same process,
// same outbound connection pool, same Gemini API key/quota bucket, so it
// could still contend with that user's own request for resources. Triggering
// it once at server boot (see warmUpGemini, called from index.ts before the
// server starts accepting traffic) means it's normally finished — or at
// least well underway — before any real request exists to contend with.
let groundingAvailable = false;
let probeStarted = false;

export function warmUpGemini(): void {
  if (probeStarted) return;
  probeStarted = true;
  if (!process.env.GEMINI_API_KEY) return;
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
      console.log("[gemini] grounding (Google Search tool) probe succeeded — native search enabled");
    } catch (err) {
      groundingAvailable = false;
      // Previously swallowed silently — this single log line is what made
      // a real, live production question ("why does search never seem to
      // fire?") unanswerable from logs alone. A 429/RESOURCE_EXHAUSTED here
      // means this API key's tier has zero quota for the search tool
      // specifically (a separate quota bucket from plain chat) — the exact
      // same failure mode confirmed for image generation on this same key.
      console.warn(
        "[gemini] grounding (Google Search tool) probe failed — native search DISABLED for this process:",
        err instanceof Error ? err.message : err
      );
    }
  })();
}

// Declaring the googleSearch tool at all — even on a turn the model ends up
// answering from its own knowledge — measurably slows generation (~1s vs
// ~5s, confirmed by direct timing). So it's not enough to gate on whether
// grounding is *available*; only actually declare the tool on a turn that
// plausibly needs fresh, real-world info (needsCurrentInfo, shared with the
// provider-independent search layer in contextManager.ts so both use the
// exact same signal). See hasAnySearchProviderConfigured() below for why
// this tool is skipped entirely once an external search provider exists.

// Declaring the googleSearch tool costs real latency, and — confirmed
// directly in production chat_timing logs — an unpredictable tail: most
// search-grounded first tokens land under a second, some run 4-10s, and a
// handful blew straight through the router's 15s first-token deadline and
// failed the whole request outright (logged as "all providers exhausted"),
// with nothing to fall back to in a Gemini-only deployment. A plain
// (non-search) first token is consistently fast in the same logs
// (400-1000ms). So a search attempt that's produced nothing within this
// soft budget is abandoned in favor of the fast plain path — trading live
// grounding on that one turn for an actual answer instead of a hard
// failure. Configurable since the right budget depends on what a given
// deployment's own measured search-latency tail looks like.
const SEARCH_SOFT_TIMEOUT_MS = Number(process.env.GEMINI_SEARCH_SOFT_TIMEOUT_MS) || 6000;

export const geminiProvider: LlmProvider = {
  async streamChatCompletion(systemPrompt, history, onDelta, onWebSources, opts) {
    const lastUserMessage = [...history].reverse().find((h) => h.role === "user")?.content ?? "";
    // Skipped entirely once an external search provider is configured — in
    // that mode contextManager.ts already ran the search upstream and
    // injected results into the system prompt for whichever provider ends
    // up answering (Gemini included), so declaring this tool too would just
    // pay its latency cost for a second, redundant search. This is what
    // keeps Gemini's own tool as a pure interim fallback rather than a
    // second, competing current-info mechanism.
    const tryWithSearch = groundingAvailable && !hasAnySearchProviderConfigured() && needsCurrentInfo(lastUserMessage);
    let deltasSent = 0;

    // groundingMetadata is only populated on later chunks (often the last
    // one), so keep the latest value seen rather than the first.
    async function attempt(
      withSearch: boolean,
      signal: AbortSignal | undefined = opts?.signal,
      deltaHandler: (text: string) => void = onDelta
    ): Promise<unknown> {
      const stream = await getClient().models.generateContentStream(
        buildRequest(systemPrompt, history, withSearch, signal)
      );
      let grounding: unknown;
      for await (const chunk of stream) {
        const text = chunk.text;
        if (text) {
          deltaHandler(text);
          deltasSent++;
        }
        const md = chunk.candidates?.[0]?.groundingMetadata;
        if (md) grounding = md;
      }
      return grounding;
    }

    // Races the search-grounded attempt against SEARCH_SOFT_TIMEOUT_MS.
    // Once the search attempt's first real delta arrives, the race is
    // already decided in its favor — real content is reaching the user, so
    // it's left alone to stream to completion no matter how long the rest
    // takes. Only a first token that never shows up within the soft budget
    // (nothing sent yet, so nothing to lose) triggers abandoning it for the
    // plain path.
    async function attemptSearchWithFastFallback(): Promise<unknown> {
      const searchController = new AbortController();
      if (opts?.signal) {
        if (opts.signal.aborted) searchController.abort();
        else opts.signal.addEventListener("abort", () => searchController.abort(), { once: true });
      }

      let firstTokenArrived = false;
      let resolveRace!: () => void;
      const firstTokenSignal = new Promise<void>((resolve) => {
        resolveRace = resolve;
      });

      const searchPromise = attempt(true, searchController.signal, (text) => {
        firstTokenArrived = true;
        resolveRace();
        onDelta(text);
      });
      // If the soft timeout below wins the race, this attempt is abandoned
      // but keeps running until the abort actually lands — swallow that
      // eventual rejection here so it never surfaces as an unhandled
      // rejection; the real outcome is this function's own return value.
      searchPromise.catch(() => {});

      const timer = new Promise<void>((resolve) => setTimeout(resolve, SEARCH_SOFT_TIMEOUT_MS));
      await Promise.race([firstTokenSignal, timer, searchPromise.then(() => undefined, () => undefined)]);

      if (firstTokenArrived) return searchPromise;

      if (opts?.signal?.aborted) {
        // The outer router-level deadline fired, not our soft budget —
        // nothing left to usefully retry; surface whatever this settles to
        // (almost certainly an AbortError).
        return searchPromise;
      }

      // Soft budget elapsed with nothing streamed, or the attempt failed
      // outright before producing anything — either way, safe to abandon
      // (deltasSent is still 0 for this turn) and answer from the fast path.
      searchController.abort();
      deltasSent = 0;
      return attempt(false);
    }

    try {
      let grounding: unknown;
      try {
        grounding = tryWithSearch ? await attemptSearchWithFastFallback() : await attempt(false);
      } catch (err) {
        // 503/UNAVAILABLE means Google's own infrastructure is momentarily
        // overloaded — their error message literally says "try again
        // later." Observed directly in production logs. A single brief
        // retry resolves this almost every time, so do it here instead of
        // making every transient blip a hard failure for the user. Only
        // safe when nothing streamed yet (deltasSent === 0) — retrying
        // after a partial reply would duplicate what they already saw.
        if ((err as { status?: number })?.status === 503 && deltasSent === 0) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          grounding = tryWithSearch ? await attemptSearchWithFastFallback() : await attempt(false);
        } else {
          throw err;
        }
      }

      // Gemini can resolve a stream successfully with literally no text
      // output at all — no exception thrown, nothing for the catch blocks
      // here or in the router to react to. Confirmed directly in
      // production logs: a request completed ("[router] gemini ok") with
      // zero deltas ever sent, leaving the user's turn answered with
      // nothing. The model appears to attempt a function-call-shaped
      // response in this case (sometimes even when no tool was declared
      // for the turn) rather than answering in text. One retry, forcing
      // plain text (withSearch: false, regardless of what this turn
      // originally tried), resolves it in practice — safe only because
      // nothing has streamed yet, same guard as the 503 retry above. If
      // this retry also comes back empty, chatRunner.ts's own fallback
      // (see executeChatRun) guarantees the user still sees *something*
      // rather than a silently empty, permanently "thinking"-looking reply.
      if (deltasSent === 0) {
        grounding = await attempt(false);
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
        await attempt(false);
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
