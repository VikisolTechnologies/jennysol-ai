import type { ChatTurn, WebSource } from "./llmProvider.js";
import { buildSystemPrompt, streamChatCompletion, noProviderConfigured, AllProvidersUnavailableError } from "./llm.js";
import type { RouteResult } from "./llm.js";
import { buildContext, summarizeIfNeeded, type BuiltContext } from "./contextManager.js";
import { classifyTask } from "./models/modelRegistry.js";
import { isIdentityQuestion, CANONICAL_IDENTITY_RESPONSE } from "./identity.js";
import { isDateTimeQuestion, getCurrentDateTimeResponse } from "./dateTime.js";
import {
  addMessage,
  conversationExists,
  createConversation,
  getConversationMessages,
} from "./conversationStore.js";
import * as runStore from "./agentRunStore.js";
import { publish } from "./runBus.js";
import { registerRun, unregisterRun } from "./runCancellation.js";

function emit(runId: string, type: string, payload?: unknown): runStore.AgentEvent {
  const event = runStore.appendEvent(runId, type, payload);
  publish(runId, event);
  return event;
}

export interface StartChatRunParams {
  userId: string;
  requestId: string;
  message: string;
  conversationId?: string;
}

export interface StartChatRunResult {
  run: runStore.AgentRun;
  conversationId: string;
  isNewConversation: boolean;
}

// All-synchronous (SQLite writes only, no network calls) — this is what lets
// the HTTP route acknowledge the request within milliseconds, before any
// model call has started. The actual generation is kicked off separately via
// executeChatRun, detached from whatever called this.
export function startChatRun(params: StartChatRunParams): StartChatRunResult {
  // Scoped by userId, same as the pre-existing behavior this replaces: a
  // conversationId belonging to another user silently falls through to
  // "start a new conversation" rather than granting cross-account access.
  const isNewConversation = !params.conversationId || !conversationExists(params.userId, params.conversationId);
  const conversationId = isNewConversation
    ? createConversation(params.userId, params.message)
    : params.conversationId!;

  // Saved up front — if generation fails below, the question is still in
  // history for a retry instead of being lost.
  addMessage(params.userId, conversationId, "user", params.message);

  const run = runStore.createRun({
    userId: params.userId,
    conversationId,
    requestId: params.requestId,
    userMessage: params.message,
  });

  return { run, conversationId, isNewConversation };
}

interface RunTimings {
  startedAt: number;
  contextBuiltAt?: number;
  firstTokenAt?: number;
  completedAt?: number;
}

function describeError(err: unknown): string {
  // Shown verbatim as Jenny's reply — never forward raw provider error
  // bodies here (a provider SDK's err.message is often literally a
  // JSON-stringified blob of the underlying HTTP error).
  if (err instanceof AllProvidersUnavailableError) {
    console.error("[router] all providers exhausted:", err.attempts);
    return noProviderConfigured()
      ? "AI isn't set up on this server yet — no provider has valid credentials configured. Check the server's environment variables."
      : "I can't reach any AI engine right now — they're all temporarily unavailable. Give it a moment and try again.";
  }
  const apiStatus = (err as { status?: number })?.status;
  return apiStatus === 429
    ? "I'm getting rate-limited right now — too many requests in a short window. Give it a minute and try again."
    : apiStatus === 503
      ? "The model I run on is under heavy load right now. Give it a moment and try again."
      : "Something went wrong on my end answering that. Mind trying again?";
}

function logTiming(
  runId: string,
  requestId: string,
  userId: string,
  routeResult: RouteResult,
  timings: RunTimings,
  context: BuiltContext
) {
  console.log(
    JSON.stringify({
      event: "chat_timing",
      requestId,
      runId,
      userId,
      provider: routeResult.providerUsed,
      model: routeResult.model ?? null,
      fellBack: routeResult.fellBack,
      hedged: routeResult.hedged ?? false,
      retrievalSkipped: context.retrievalSkipped,
      historyTurnsSent: context.turns.length,
      contextBuiltMs: timings.contextBuiltAt ? timings.contextBuiltAt - timings.startedAt : null,
      firstTokenMs: timings.firstTokenAt ? timings.firstTokenAt - timings.startedAt : null,
      totalMs: timings.completedAt ? timings.completedAt - timings.startedAt : null,
    })
  );
}

// Runs independently of any HTTP response — persists to SQLite regardless of
// whether a client is still connected to watch it happen, and regardless of
// whether the process that called this is the one that eventually reads the
// result. This is the concrete mechanism behind "Chrome closed ≠ Jenny
// stopped": nothing in this function's control flow depends on any `res`
// object, only on the run's own id, so an HTTP handler can subscribe to it,
// stop subscribing when the client disconnects, and this keeps going.
export async function executeChatRun(
  runId: string,
  requestId: string,
  userId: string,
  conversationId: string,
  message: string,
  timezone?: string
): Promise<void> {
  const timings: RunTimings = { startedAt: Date.now() };
  emit(runId, "run.started", { requestId, runId, conversationId, timestamp: new Date().toISOString() });
  runStore.markFirstEvent(runId);
  emit(runId, "agent.status", { status: "thinking" });

  // Registered before any provider call so a cancel request arriving the
  // instant this run starts still has a controller to find — unregistered
  // in the finally below regardless of how this run ends, so a runId is
  // never left pointing at a stale controller for a run that's actually done.
  const cancellation = registerRun(runId);

  try {
    // Deterministic, model-free short-circuit for "who created you" style
    // questions — see identity.ts for why this can't be left to the model
    // (or the persona) to get right consistently. Checked before any
    // provider/context work: no reason to pay for a search/context build
    // when the answer never depends on either.
    if (isIdentityQuestion(message)) {
      timings.firstTokenAt = Date.now();
      runStore.markFirstToken(runId);
      emit(runId, "agent.status", { status: "streaming" });
      runStore.appendResponseText(runId, CANONICAL_IDENTITY_RESPONSE);
      emit(runId, "message.delta", { delta: CANONICAL_IDENTITY_RESPONSE });

      addMessage(userId, conversationId, "assistant", CANONICAL_IDENTITY_RESPONSE, []);
      runStore.markCompleted(runId, "identity", []);
      timings.completedAt = Date.now();
      emit(runId, "done", { sources: [] });
      console.log(
        JSON.stringify({
          event: "chat_timing",
          requestId,
          runId,
          userId,
          provider: "identity",
          fellBack: false,
          totalMs: timings.completedAt - timings.startedAt,
        })
      );
      return;
    }

    // Same rationale as identity above, for "what time/date is it" — the
    // server's own clock is authoritative and free to read; there's no
    // reason to ask a model to reason about something this deterministic,
    // and confirmed in production, some models flatly denied having any
    // clock access at all rather than using the date already in their
    // system prompt.
    if (isDateTimeQuestion(message)) {
      const response = getCurrentDateTimeResponse(timezone);
      timings.firstTokenAt = Date.now();
      runStore.markFirstToken(runId);
      emit(runId, "agent.status", { status: "streaming" });
      runStore.appendResponseText(runId, response);
      emit(runId, "message.delta", { delta: response });

      addMessage(userId, conversationId, "assistant", response, []);
      runStore.markCompleted(runId, "datetime", []);
      timings.completedAt = Date.now();
      emit(runId, "done", { sources: [] });
      console.log(
        JSON.stringify({
          event: "chat_timing",
          requestId,
          runId,
          userId,
          provider: "datetime",
          fellBack: false,
          totalMs: timings.completedAt - timings.startedAt,
        })
      );
      return;
    }

    // The user's own turn was already persisted by startChatRun, so history
    // here already includes it as the last message.
    const fullHistory: ChatTurn[] = getConversationMessages(userId, conversationId);
    const context = await buildContext(userId, conversationId, message, fullHistory.slice(0, -1));
    timings.contextBuiltAt = Date.now();

    const systemPrompt = buildSystemPrompt({
      documentChunks: context.documentMatches.map((m) => m.text),
      webChunks: context.webChunks,
      weatherChunk: context.weatherChunk,
    });

    let fullReply = "";
    // Pre-seeded with whatever the provider-independent search layer
    // already found (see contextManager.ts) — the onWebSources callback
    // below only ever fires from Gemini's own native grounding tool, which
    // is itself only attempted when no external search provider is
    // configured (see gemini.ts), so these two sources never both populate
    // for the same turn; concatenating is just cheap defense-in-depth.
    let webSources: WebSource[] = context.webSources;
    let firstTokenSeen = false;

    const routeResult = await streamChatCompletion(
      systemPrompt,
      context.turns,
      (delta) => {
        if (!firstTokenSeen) {
          firstTokenSeen = true;
          timings.firstTokenAt = Date.now();
          runStore.markFirstToken(runId);
          emit(runId, "agent.status", { status: "streaming" });
        }
        fullReply += delta;
        runStore.appendResponseText(runId, delta);
        emit(runId, "message.delta", { delta });
      },
      (found) => {
        webSources = [...webSources, ...found];
      },
      classifyTask(message),
      cancellation.signal
    );

    // Guaranteed safety net: a provider can resolve "successfully" (no
    // exception, so nothing above would have caught this) while producing
    // literally zero text — confirmed directly in production logs, a
    // request completing with firstTokenMs=null. Without this, that turn
    // gets silently saved and marked "done" as an empty message, which the
    // frontend then renders as a permanently-empty bubble — indistinguishable
    // from still being stuck, with no error and nothing to retry against.
    // Gemini's own provider already retries once internally for exactly
    // this case (see gemini.ts); this is the guarantee of last resort,
    // provider-agnostic, so the user is never left with silently nothing.
    if (!fullReply.trim()) {
      const fallback =
        "I wasn't able to put together an answer for that one — mind trying again, maybe with a little more detail?";
      fullReply = fallback;
      if (!firstTokenSeen) {
        firstTokenSeen = true;
        timings.firstTokenAt = Date.now();
        runStore.markFirstToken(runId);
        emit(runId, "agent.status", { status: "streaming" });
      }
      runStore.appendResponseText(runId, fallback);
      emit(runId, "message.delta", { delta: fallback });
    }

    const sources = [
      ...context.documentMatches.map((m) => ({
        type: "document" as const,
        documentId: m.documentId,
        text: m.text.slice(0, 160),
      })),
      ...webSources.map((s) => ({ type: "web" as const, title: s.title, url: s.url, domain: s.domain })),
    ];

    // Persist before announcing completion, never the other way around — a
    // client that sees "done" must always be able to find the finished
    // message already saved if it reloads at that exact instant.
    addMessage(userId, conversationId, "assistant", fullReply, sources);
    runStore.markCompleted(runId, routeResult.providerUsed, sources);
    timings.completedAt = Date.now();
    emit(runId, "done", { sources });

    summarizeIfNeeded(conversationId, [
      ...fullHistory.slice(0, -1),
      { role: "user", content: message },
      { role: "assistant", content: fullReply },
    ]);

    logTiming(runId, requestId, userId, routeResult, timings, context);
  } catch (err) {
    if ((err as { code?: string })?.code === "cancelled") {
      // Not a failure — the user asked this specific run to stop. Whatever
      // partial text streamed before cancellation is already persisted via
      // appendResponseText (called on every delta as it arrived), so a
      // cancelled run still shows what it got through, not a blank slate.
      runStore.markCancelled(runId);
      emit(runId, "cancelled", {});
    } else {
      console.error(`[run ${runId}] failed:`, err);
      const message = describeError(err);
      runStore.markFailed(runId, message);
      emit(runId, "error", { error: message });
    }
  } finally {
    unregisterRun(runId);
  }
}
