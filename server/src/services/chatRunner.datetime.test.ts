import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";

// Same proof shape as chatRunner.identity.test.ts: a real executeChatRun
// call for a date/time question must never invoke streamChatCompletion,
// and must persist a response containing the real current year.
vi.mock("./llm.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./llm.js")>();
  return { ...actual, streamChatCompletion: vi.fn() };
});

import { db } from "../db/index.js";
import { streamChatCompletion } from "./llm.js";
import { startChatRun, executeChatRun } from "./chatRunner.js";
import { getRun } from "./agentRunStore.js";
import { getConversationMessages } from "./conversationStore.js";

function makeUser(): string {
  const userId = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, 'x', 'Test User')").run(
    userId,
    `${userId}@example.test`
  );
  return userId;
}

describe("chatRunner date/time short-circuit", () => {
  let userId: string;

  beforeEach(() => {
    userId = makeUser();
    vi.mocked(streamChatCompletion).mockClear();
  });

  afterEach(() => {
    db.prepare("DELETE FROM users WHERE id = ?").run(userId); // cascades
  });

  it("answers a time question with a dynamically-computed response and never calls a model provider", async () => {
    const { run, conversationId } = startChatRun({
      userId,
      requestId: "req-datetime-1",
      message: "What's current time",
    });

    await executeChatRun(run.id, "req-datetime-1", userId, conversationId, "What's current time");

    expect(streamChatCompletion).not.toHaveBeenCalled();

    const finalRun = getRun(userId, run.id)!;
    expect(finalRun.status).toBe("completed");
    expect(finalRun.provider).toBe("datetime");
    expect(finalRun.responseText).toContain(new Date().getUTCFullYear().toString());

    const messages = getConversationMessages(userId, conversationId);
    expect(messages.at(-1)?.role).toBe("assistant");
    expect(messages.at(-1)?.content).toContain("UTC");
  });
});
