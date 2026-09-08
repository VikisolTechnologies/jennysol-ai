import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";

// agentRunStore imports the real db module (better-sqlite3, file-backed) —
// unlike modelRouter/contextManager this isn't mocked, since the whole
// point of this store is durable SQLite persistence surviving disconnects.
// Uses the actual dev data file; each test creates its own throwaway
// user/conversation rows via randomUUID() so runs don't collide across
// test runs, and cleans up what it inserted in afterEach.
import { db } from "../db/index.js";
import * as runStore from "./agentRunStore.js";

function makeUserAndConversation() {
  const userId = randomUUID();
  const conversationId = randomUUID();
  db.prepare(
    "INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, 'x', 'Test User')"
  ).run(userId, `${userId}@example.test`);
  db.prepare("INSERT INTO conversations (id, user_id, title) VALUES (?, ?, 'Test')").run(conversationId, userId);
  return { userId, conversationId };
}

describe("agentRunStore", () => {
  let userId: string;
  let conversationId: string;

  beforeEach(() => {
    ({ userId, conversationId } = makeUserAndConversation());
  });

  afterEach(() => {
    db.prepare("DELETE FROM users WHERE id = ?").run(userId); // cascades conversations/runs/events
  });

  it("creates a run in 'queued' status, scoped to its owner", () => {
    const run = runStore.createRun({ userId, conversationId, requestId: "req-1", userMessage: "hi" });
    expect(run.status).toBe("queued");
    expect(run.userMessage).toBe("hi");
    expect(run.responseText).toBe("");

    expect(runStore.getRun(userId, run.id)).not.toBeNull();
    expect(runStore.getRun(randomUUID(), run.id)).toBeNull(); // wrong user can't see it
  });

  it("walks queued -> running -> streaming -> completed, persisting text as it arrives", () => {
    const run = runStore.createRun({ userId, conversationId, requestId: "req-2", userMessage: "hi" });

    runStore.markFirstEvent(run.id);
    expect(runStore.getRun(userId, run.id)!.status).toBe("running");

    runStore.markFirstToken(run.id);
    expect(runStore.getRun(userId, run.id)!.status).toBe("streaming");

    runStore.appendResponseText(run.id, "Hello");
    runStore.appendResponseText(run.id, " there");
    expect(runStore.getRun(userId, run.id)!.responseText).toBe("Hello there");

    runStore.markCompleted(run.id, "gemini", []);
    const finalRun = runStore.getRun(userId, run.id)!;
    expect(finalRun.status).toBe("completed");
    expect(finalRun.provider).toBe("gemini");
    expect(finalRun.completedAt).not.toBeNull();
    // The response text landed via appendResponseText all along — completion
    // never depends on markCompleted itself carrying the text.
    expect(finalRun.responseText).toBe("Hello there");
  });

  it("marks a run failed with the error message preserved", () => {
    const run = runStore.createRun({ userId, conversationId, requestId: "req-3", userMessage: "hi" });
    runStore.markFailed(run.id, "All configured AI providers are currently unavailable");

    const finalRun = runStore.getRun(userId, run.id)!;
    expect(finalRun.status).toBe("failed");
    expect(finalRun.error).toBe("All configured AI providers are currently unavailable");
  });

  it("appends events and replays only what's after a given cursor", () => {
    const run = runStore.createRun({ userId, conversationId, requestId: "req-4", userMessage: "hi" });
    const e1 = runStore.appendEvent(run.id, "run.started", { a: 1 });
    const e2 = runStore.appendEvent(run.id, "message.delta", { delta: "Hi" });
    runStore.appendEvent(run.id, "message.delta", { delta: " there" });

    const afterE1 = runStore.getEventsAfter(run.id, e1.id);
    expect(afterE1.map((e) => e.type)).toEqual(["message.delta", "message.delta"]);

    const afterE2 = runStore.getEventsAfter(run.id, e2.id);
    expect(afterE2).toHaveLength(1);
    expect(afterE2[0].payload).toEqual({ delta: " there" });
  });

  it("lists active runs and unseen-completed runs, but not seen-and-finished ones", () => {
    const active = runStore.createRun({ userId, conversationId, requestId: "req-5", userMessage: "in flight" });

    const finishedUnseen = runStore.createRun({ userId, conversationId, requestId: "req-6", userMessage: "done" });
    runStore.markCompleted(finishedUnseen.id, "gemini", []);

    const finishedSeen = runStore.createRun({ userId, conversationId, requestId: "req-7", userMessage: "seen already" });
    runStore.markCompleted(finishedSeen.id, "gemini", []);
    runStore.markSeen(userId, finishedSeen.id);

    const listed = runStore.listActiveOrUnseenRuns(userId).map((r) => r.id);
    expect(listed).toContain(active.id);
    expect(listed).toContain(finishedUnseen.id);
    expect(listed).not.toContain(finishedSeen.id);
  });

  it("getActiveRunForConversation finds an in-flight run and ignores completed ones", () => {
    const run = runStore.createRun({ userId, conversationId, requestId: "req-8", userMessage: "hi" });
    expect(runStore.getActiveRunForConversation(userId, conversationId)?.id).toBe(run.id);

    runStore.markCompleted(run.id, "gemini", []);
    expect(runStore.getActiveRunForConversation(userId, conversationId)).toBeNull();
  });
});
