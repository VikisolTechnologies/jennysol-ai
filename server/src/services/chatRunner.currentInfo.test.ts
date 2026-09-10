import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";

// Proves the current-info safety gate added 2026-09-10: when a question
// needs live verification and no live evidence (search results, Gemini's
// native grounding, or — for weather — the weather provider) is actually
// obtainable this turn, the model must never be called at all — this is
// what makes "don't guess from stale training data" a guarantee instead of
// a persona instruction the model can occasionally ignore (the confirmed,
// reproduced production case: "Who is the current Queen of Thailand?" got
// a confident, unhedged, wrong-in-spirit answer despite that instruction
// already existing).
vi.mock("./llm.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./llm.js")>();
  return { ...actual, streamChatCompletion: vi.fn() };
});

vi.mock("./search/searchRouter.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./search/searchRouter.js")>();
  return { ...actual, hasAnySearchProviderConfigured: vi.fn(() => false), search: vi.fn() };
});

vi.mock("./providers/gemini.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./providers/gemini.js")>();
  return { ...actual, isGeminiGroundingAvailable: vi.fn(() => false) };
});

import { db } from "../db/index.js";
import { streamChatCompletion } from "./llm.js";
import { startChatRun, executeChatRun } from "./chatRunner.js";
import { getRun } from "./agentRunStore.js";
import { getConversationMessages } from "./conversationStore.js";
import { CURRENT_INFO_UNAVAILABLE_RESPONSE } from "./currentInfo.js";
import { hasAnySearchProviderConfigured, search as runWebSearch } from "./search/searchRouter.js";
import { isGeminiGroundingAvailable } from "./providers/gemini.js";

function makeUser(): string {
  const userId = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, 'x', 'Test User')").run(
    userId,
    `${userId}@example.test`
  );
  return userId;
}

describe("chatRunner current-info safety gate", () => {
  let userId: string;

  beforeEach(() => {
    userId = makeUser();
    vi.mocked(streamChatCompletion).mockReset();
    vi.mocked(streamChatCompletion).mockResolvedValue({ providerUsed: "gemini", fellBack: false });
    vi.mocked(hasAnySearchProviderConfigured).mockReset().mockReturnValue(false);
    vi.mocked(runWebSearch).mockReset().mockResolvedValue(null);
    vi.mocked(isGeminiGroundingAvailable).mockReset().mockReturnValue(false);
  });

  afterEach(() => {
    db.prepare("DELETE FROM users WHERE id = ?").run(userId); // cascades
  });

  it("no search configured, no grounding available -> honest fallback, model never called", async () => {
    const message = "What is the latest news about OpenAI?";
    const { run, conversationId } = startChatRun({ userId, requestId: "req-ci-1", message });

    await executeChatRun(run.id, "req-ci-1", userId, conversationId, message);

    expect(streamChatCompletion).not.toHaveBeenCalled();
    const finalRun = getRun(userId, run.id)!;
    expect(finalRun.status).toBe("completed");
    expect(finalRun.responseText).toBe(CURRENT_INFO_UNAVAILABLE_RESPONSE);
    expect(finalRun.provider).toBe("current_info_unavailable");

    const messages = getConversationMessages(userId, conversationId);
    expect(messages.at(-1)).toMatchObject({ role: "assistant", content: CURRENT_INFO_UNAVAILABLE_RESPONSE });
  });

  it("regression: 'Who is the current Queen of Thailand?' — the exact confirmed production gap", async () => {
    const message = "Who is the current Queen of Thailand?";
    const { run, conversationId } = startChatRun({ userId, requestId: "req-ci-2", message });

    await executeChatRun(run.id, "req-ci-2", userId, conversationId, message);

    expect(streamChatCompletion).not.toHaveBeenCalled();
    expect(getRun(userId, run.id)!.responseText).toBe(CURRENT_INFO_UNAVAILABLE_RESPONSE);
  });

  it("regression: 'What is the current price of Bitcoin?'", async () => {
    const message = "What is the current price of Bitcoin?";
    const { run, conversationId } = startChatRun({ userId, requestId: "req-ci-3", message });
    await executeChatRun(run.id, "req-ci-3", userId, conversationId, message);
    expect(streamChatCompletion).not.toHaveBeenCalled();
    expect(getRun(userId, run.id)!.responseText).toBe(CURRENT_INFO_UNAVAILABLE_RESPONSE);
  });

  it("regression: 'Who is currently the Prime Minister of India?'", async () => {
    const message = "Who is currently the Prime Minister of India?";
    const { run, conversationId } = startChatRun({ userId, requestId: "req-ci-4", message });
    await executeChatRun(run.id, "req-ci-4", userId, conversationId, message);
    expect(streamChatCompletion).not.toHaveBeenCalled();
    expect(getRun(userId, run.id)!.responseText).toBe(CURRENT_INFO_UNAVAILABLE_RESPONSE);
  });

  it("regression: 'What happened today?'", async () => {
    const message = "What happened today?";
    const { run, conversationId } = startChatRun({ userId, requestId: "req-ci-5", message });
    await executeChatRun(run.id, "req-ci-5", userId, conversationId, message);
    expect(streamChatCompletion).not.toHaveBeenCalled();
    expect(getRun(userId, run.id)!.responseText).toBe(CURRENT_INFO_UNAVAILABLE_RESPONSE);
  });

  it("search configured but returns zero results -> still an honest fallback, not a guess", async () => {
    vi.mocked(hasAnySearchProviderConfigured).mockReturnValue(true);
    vi.mocked(runWebSearch).mockResolvedValue({ results: [] });

    const message = "What is the latest OpenAI model?";
    const { run, conversationId } = startChatRun({ userId, requestId: "req-ci-6", message });
    await executeChatRun(run.id, "req-ci-6", userId, conversationId, message);

    expect(streamChatCompletion).not.toHaveBeenCalled();
    expect(getRun(userId, run.id)!.responseText).toBe(CURRENT_INFO_UNAVAILABLE_RESPONSE);
  });

  it("search configured and returns real results -> proceeds normally, model IS called with them", async () => {
    vi.mocked(hasAnySearchProviderConfigured).mockReturnValue(true);
    vi.mocked(runWebSearch).mockResolvedValue({
      results: [{ title: "OpenAI news", url: "https://example.test/a", domain: "example.test", snippet: "..." }],
    });

    const message = "What is the latest news about OpenAI?";
    const { run, conversationId } = startChatRun({ userId, requestId: "req-ci-7", message });
    await executeChatRun(run.id, "req-ci-7", userId, conversationId, message);

    expect(streamChatCompletion).toHaveBeenCalledTimes(1);
    expect(getRun(userId, run.id)!.provider).not.toBe("current_info_unavailable");
  });

  it("no external search configured but Gemini grounding IS available -> lets the model attempt it", async () => {
    vi.mocked(isGeminiGroundingAvailable).mockReturnValue(true);

    const message = "What is the latest news about NVIDIA?";
    const { run, conversationId } = startChatRun({ userId, requestId: "req-ci-8", message });
    await executeChatRun(run.id, "req-ci-8", userId, conversationId, message);

    expect(streamChatCompletion).toHaveBeenCalledTimes(1);
  });

  it("a weather question with no location given is NOT overridden by the generic fallback (weather has its own honest 'ask for city' flow)", async () => {
    const message = "How's the weather?";
    const { run, conversationId } = startChatRun({ userId, requestId: "req-ci-9", message });
    await executeChatRun(run.id, "req-ci-9", userId, conversationId, message);

    // Must reach the model (which is the thing that actually asks "which
    // city?") rather than being silently replaced by the generic
    // "can't verify live sources" message.
    expect(streamChatCompletion).toHaveBeenCalledTimes(1);
    expect(getRun(userId, run.id)!.provider).not.toBe("current_info_unavailable");
  });

  it("a non-current-info message is completely unaffected by the gate", async () => {
    const message = "What's 2 + 2?";
    const { run, conversationId } = startChatRun({ userId, requestId: "req-ci-10", message });
    await executeChatRun(run.id, "req-ci-10", userId, conversationId, message);

    expect(streamChatCompletion).toHaveBeenCalledTimes(1);
    expect(getRun(userId, run.id)!.provider).not.toBe("current_info_unavailable");
  });
});
