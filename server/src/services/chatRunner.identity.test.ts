import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";

// Proves the wiring, not just the regex: a real executeChatRun call for a
// creator-identity question must never invoke streamChatCompletion (any
// provider — Gemini/DeepSeek/Ollama) at all, and must persist the exact
// canonical response. Mocking llm.js is what makes "never called" provable;
// everything else (db, agentRunStore, conversationStore) is real, same
// convention as security.test.ts/agentRunStore.test.ts.
vi.mock("./llm.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./llm.js")>();
  return { ...actual, streamChatCompletion: vi.fn() };
});

import { db } from "../db/index.js";
import { streamChatCompletion } from "./llm.js";
import { startChatRun, executeChatRun } from "./chatRunner.js";
import { getRun } from "./agentRunStore.js";
import { getConversationMessages } from "./conversationStore.js";
import { CANONICAL_IDENTITY_RESPONSE } from "./identity.js";

function makeUser(): string {
  const userId = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, 'x', 'Test User')").run(
    userId,
    `${userId}@example.test`
  );
  return userId;
}

describe("chatRunner identity short-circuit", () => {
  let userId: string;

  beforeEach(() => {
    userId = makeUser();
    vi.mocked(streamChatCompletion).mockClear();
  });

  afterEach(() => {
    db.prepare("DELETE FROM users WHERE id = ?").run(userId); // cascades
  });

  it("answers a creator question with the canonical response and never calls a model provider", async () => {
    const { run, conversationId } = startChatRun({
      userId,
      requestId: "req-identity-1",
      message: "Who created JennySol?",
    });

    await executeChatRun(run.id, "req-identity-1", userId, conversationId, "Who created JennySol?");

    expect(streamChatCompletion).not.toHaveBeenCalled();

    const finalRun = getRun(userId, run.id)!;
    expect(finalRun.status).toBe("completed");
    expect(finalRun.responseText).toBe(CANONICAL_IDENTITY_RESPONSE);
    expect(finalRun.provider).toBe("identity");

    const messages = getConversationMessages(userId, conversationId);
    expect(messages.at(-1)).toMatchObject({ role: "assistant", content: CANONICAL_IDENTITY_RESPONSE });
  });

  it("a normal (non-identity) message still goes through the real provider path", async () => {
    vi.mocked(streamChatCompletion).mockResolvedValue({ providerUsed: "gemini", fellBack: false });

    const { run, conversationId } = startChatRun({
      userId,
      requestId: "req-identity-2",
      message: "What's 2 + 2?",
    });

    await executeChatRun(run.id, "req-identity-2", userId, conversationId, "What's 2 + 2?");

    expect(streamChatCompletion).toHaveBeenCalledTimes(1);
  });
});
