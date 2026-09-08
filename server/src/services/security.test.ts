// Cross-user data-isolation regression suite — see docs/SECURITY_AUDIT.md
// for the incident this exists to prevent recurring. Uses the real SQLite
// db module (same convention as agentRunStore.test.ts), not mocks: the
// whole point is proving the actual WHERE-clause/JOIN scoping in the real
// store functions, not a mocked stand-in for them.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import * as conversationStore from "./conversationStore.js";
import * as runStore from "./agentRunStore.js";
import * as vectorStore from "./vectorStore.js";
import { startChatRun } from "./chatRunner.js";

function makeUser(): string {
  const userId = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, 'x', 'Test User')").run(
    userId,
    `${userId}@example.test`
  );
  return userId;
}

describe("cross-user data isolation (security regression suite)", () => {
  let userA: string;
  let userB: string;

  beforeEach(() => {
    userA = makeUser();
    userB = makeUser();
  });

  afterEach(() => {
    // Cascades conversations/messages/agent_runs/agent_events/documents/chunks.
    db.prepare("DELETE FROM users WHERE id IN (?, ?)").run(userA, userB);
  });

  describe("conversations and messages", () => {
    it("Test 1: User B listing conversations never includes User A's", () => {
      const convA = conversationStore.createConversation(userA, "A's private question");
      conversationStore.createConversation(userB, "B's own question");

      const bList = conversationStore.listConversations(userB);
      expect(bList.map((c) => c.id)).not.toContain(convA);
    });

    it("Test 2/3: User B cannot load User A's conversation or its messages", () => {
      const convA = conversationStore.createConversation(userA, "A's private question");
      conversationStore.addMessage(userA, convA, "user", "This is private");
      conversationStore.addMessage(userA, convA, "assistant", "So is this reply");

      expect(conversationStore.conversationExists(userB, convA)).toBe(false);
      expect(conversationStore.getConversationMessages(userB, convA)).toEqual([]);

      // A's own access is unaffected (Test 6).
      expect(conversationStore.conversationExists(userA, convA)).toBe(true);
      expect(conversationStore.getConversationMessages(userA, convA)).toHaveLength(2);
    });

    it("User B cannot delete or silently mutate User A's conversation by guessing its id", () => {
      const convA = conversationStore.createConversation(userA, "A's conversation");
      conversationStore.deleteConversation(userB, convA); // no-op: WHERE id = ? AND user_id = ? matches nothing
      expect(conversationStore.conversationExists(userA, convA)).toBe(true);
    });

    it("addMessage from a non-owner does not update the conversation's updated_at (defense in depth)", () => {
      const convA = conversationStore.createConversation(userA, "A's conversation");
      const before = (db.prepare("SELECT updated_at FROM conversations WHERE id = ?").get(convA) as { updated_at: string })
        .updated_at;
      // Not a reachable path via any real route today (every caller passes
      // the message's own author as userId) — asserted directly here as a
      // belt-and-suspenders check on the query's own WHERE clause.
      conversationStore.addMessage(userB, convA, "user", "injected");
      const after = (db.prepare("SELECT updated_at FROM conversations WHERE id = ?").get(convA) as { updated_at: string })
        .updated_at;
      expect(after).toBe(before);
    });
  });

  describe("AgentRun creation and ownership", () => {
    it("Test 4: User B cannot execute a run against User A's conversation id — a new conversation is created instead", () => {
      const convA = conversationStore.createConversation(userA, "A's conversation");

      const result = startChatRun({
        userId: userB,
        requestId: randomUUID(),
        message: "trying to piggyback on A's conversation",
        conversationId: convA,
      });

      // Never silently writes into A's conversation...
      expect(result.conversationId).not.toBe(convA);
      expect(result.isNewConversation).toBe(true);
      // ...and A's conversation gains no new message as a side effect.
      expect(conversationStore.getConversationMessages(userA, convA)).toHaveLength(0);
      // B's message landed in B's own, brand-new conversation.
      expect(conversationStore.getConversationMessages(userB, result.conversationId)).toHaveLength(1);

      db.prepare("DELETE FROM conversations WHERE id = ?").run(result.conversationId);
    });

    it("User B cannot read User A's AgentRun by id", () => {
      const convA = conversationStore.createConversation(userA, "A's conversation");
      const run = runStore.createRun({ userId: userA, conversationId: convA, requestId: "r-1", userMessage: "hi" });

      expect(runStore.getRun(userB, run.id)).toBeNull();
      expect(runStore.getRun(userA, run.id)).not.toBeNull();
    });

    it("User B's listActiveOrUnseenRuns never includes User A's runs", () => {
      const convA = conversationStore.createConversation(userA, "A's conversation");
      runStore.createRun({ userId: userA, conversationId: convA, requestId: "r-2", userMessage: "A's message" });

      const convB = conversationStore.createConversation(userB, "B's conversation");
      const runB = runStore.createRun({ userId: userB, conversationId: convB, requestId: "r-3", userMessage: "B's message" });

      const bRuns = runStore.listActiveOrUnseenRuns(userB).map((r) => r.id);
      expect(bRuns).toContain(runB.id);
      expect(bRuns.every((id) => id !== undefined)).toBe(true);
      // Every run returned actually belongs to B, not just "happens to be
      // in the list" — re-fetch each one scoped by B and confirm none 404s.
      for (const id of bRuns) expect(runStore.getRun(userB, id)).not.toBeNull();
    });

    it("Test 7: concurrent runs for different users remain independently addressable", () => {
      const convA = conversationStore.createConversation(userA, "A's conversation");
      const convB = conversationStore.createConversation(userB, "B's conversation");
      const runA = runStore.createRun({ userId: userA, conversationId: convA, requestId: "r-4", userMessage: "from A" });
      const runB = runStore.createRun({ userId: userB, conversationId: convB, requestId: "r-5", userMessage: "from B" });

      runStore.appendResponseText(runA.id, "A's answer");
      runStore.appendResponseText(runB.id, "B's answer");
      runStore.markCompleted(runA.id, "gemini", []);
      runStore.markCompleted(runB.id, "gemini", []);

      expect(runStore.getRun(userA, runA.id)!.responseText).toBe("A's answer");
      expect(runStore.getRun(userB, runB.id)!.responseText).toBe("B's answer");
      // Neither can read the other's finished run.
      expect(runStore.getRun(userB, runA.id)).toBeNull();
      expect(runStore.getRun(userA, runB.id)).toBeNull();
    });
  });

  describe("documents / memory (RAG)", () => {
    function embedding(seed: number): Float32Array {
      // Deterministic, not a real embedding — searchSimilarChunks only
      // needs *some* vector to score against; what's under test is the
      // user_id join filtering candidates, not embedding quality.
      return new Float32Array([seed, seed, seed]);
    }

    it("Test 5: User B's memory retrieval never returns User A's document chunks", () => {
      const docA = randomUUID();
      vectorStore.insertDocument(userA, docA, "A's private notes.txt");
      vectorStore.insertChunks(docA, [{ text: "A's secret plan", index: 0, embedding: embedding(1) }]);

      const docB = randomUUID();
      vectorStore.insertDocument(userB, docB, "B's own notes.txt");
      vectorStore.insertChunks(docB, [{ text: "B's own content", index: 0, embedding: embedding(1) }]);

      expect(vectorStore.documentBelongsToUser(userB, docA)).toBe(false);
      expect(vectorStore.documentBelongsToUser(userA, docA)).toBe(true);

      const bResults = vectorStore.searchSimilarChunks(userB, embedding(1), 10);
      expect(bResults.map((c) => c.text)).not.toContain("A's secret plan");
      expect(bResults.map((c) => c.text)).toContain("B's own content");
    });

    it("User B cannot delete User A's document by guessing its id", () => {
      const docA = randomUUID();
      vectorStore.insertDocument(userA, docA, "A's file.txt");
      vectorStore.deleteDocument(userB, docA); // no-op
      expect(vectorStore.documentBelongsToUser(userA, docA)).toBe(true);
    });
  });
});
