import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";

// Same convention as chatRunner.identity.test.ts: mocking llm.js proves a
// real action-handoff turn never calls a real model provider, and a real
// normal chat turn still does.
vi.mock("./llm.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./llm.js")>();
  return { ...actual, streamChatCompletion: vi.fn() };
});

import { db } from "../db/index.js";
import { streamChatCompletion } from "./llm.js";
import { startChatRun, executeChatRun } from "./chatRunner.js";
import { getRun } from "./agentRunStore.js";
import { getConversationMessages } from "./conversationStore.js";
import { clearPendingAction } from "./actions/actionState.js";

function makeUser(): string {
  const userId = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, 'x', 'Test User')").run(
    userId,
    `${userId}@example.test`
  );
  return userId;
}

describe("chatRunner action-handoff short-circuit", () => {
  let userId: string;

  beforeEach(() => {
    userId = makeUser();
    vi.mocked(streamChatCompletion).mockReset();
  });

  afterEach(() => {
    db.prepare("DELETE FROM users WHERE id = ?").run(userId); // cascades
  });

  it("resolves a real deep-link handoff via the one LLM call the intent parser needs, never a second real chat completion", async () => {
    vi.mocked(streamChatCompletion).mockImplementation(async (_sp, _hist, onDelta) => {
      onDelta(JSON.stringify({ targetId: "phone_call", slots: { number: "9876543210" } }));
      return { providerUsed: "gemini", fellBack: false } as never;
    });

    const { run, conversationId } = startChatRun({
      userId,
      requestId: "req-action-1",
      message: "call 9876543210",
    });
    await executeChatRun(run.id, "req-action-1", userId, conversationId, "call 9876543210");

    // Exactly one call: the intent parser's own classification, never a
    // second, separate normal-chat completion on top of it.
    expect(streamChatCompletion).toHaveBeenCalledTimes(1);

    const finalRun = getRun(userId, run.id)!;
    expect(finalRun.status).toBe("completed");
    expect(finalRun.provider).toBe("action_handoff");
    expect(finalRun.responseText).toContain("tel:9876543210");

    const messages = getConversationMessages(userId, conversationId);
    expect(messages.at(-1)?.content).toContain("tel:9876543210");
  });

  it("asks a real clarifying question and marks the run's provider as action_clarify", async () => {
    vi.mocked(streamChatCompletion).mockImplementation(async (_sp, _hist, onDelta) => {
      onDelta(JSON.stringify({ targetId: "phone_call", slots: {} }));
      return { providerUsed: "gemini", fellBack: false } as never;
    });

    const { run, conversationId } = startChatRun({
      userId,
      requestId: "req-action-2",
      message: "call my mom",
    });
    await executeChatRun(run.id, "req-action-2", userId, conversationId, "call my mom");

    const finalRun = getRun(userId, run.id)!;
    expect(finalRun.provider).toBe("action_clarify");
    expect(finalRun.responseText).toBe("What's the phone number to call, as stated?");

    clearPendingAction(conversationId);
  });

  it("ordinary chat with no action keyword skips the intent parser and goes straight to the real provider path", async () => {
    vi.mocked(streamChatCompletion).mockResolvedValue({ providerUsed: "gemini", fellBack: false } as never);

    const { run, conversationId } = startChatRun({
      userId,
      requestId: "req-action-3",
      message: "What's 2 + 2?",
    });
    await executeChatRun(run.id, "req-action-3", userId, conversationId, "What's 2 + 2?");

    // Exactly one call: the real chat completion, never the intent parser
    // (which would have made it two).
    expect(streamChatCompletion).toHaveBeenCalledTimes(1);
    const finalRun = getRun(userId, run.id)!;
    expect(finalRun.provider).not.toBe("action_handoff");
    expect(finalRun.provider).not.toBe("action_clarify");
  });
});
