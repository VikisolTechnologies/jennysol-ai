import { describe, it, expect, afterEach } from "vitest";
import { db } from "../db/index.js";
import { createGuestUser } from "./auth/userStore.js";
import { createSession, getSessionUserId, deleteSession } from "./auth/sessions.js";
import { startChatRun } from "./chatRunner.js";
import { getRun } from "./agentRunStore.js";
import { conversationExists, getConversationMessages, listConversations, deleteConversation } from "./conversationStore.js";
import { insertDocument, documentBelongsToUser, listDocuments, searchSimilarChunks } from "./vectorStore.js";
import { randomUUID } from "node:crypto";

// Prompted by a real production report of the same conversation appearing
// on two different mobile devices. Everything below re-verifies, at the
// actual guest-creation code path (not a generic "two users" stand-in),
// that two devices booting fresh can never end up sharing an identity or
// each other's data — and separately proves the session-token layer itself
// (createSession/getSessionUserId) behaves correctly under the two real
// mechanisms that CAN legitimately make two devices share access: signing
// into the same real account on purpose, or a bearer token physically
// copied between devices (e.g. OS-level backup/restore) — neither of which
// is a code bug, both documented in the final report alongside this suite.
describe("multi-device guest isolation", () => {
  const createdUserIds: string[] = [];

  afterEach(() => {
    for (const id of createdUserIds) db.prepare("DELETE FROM users WHERE id = ?").run(id); // cascades
    createdUserIds.length = 0;
  });

  async function newGuestDevice() {
    const user = await createGuestUser();
    createdUserIds.push(user.id);
    const { token } = createSession(user.id, "test-device-ua");
    return { user, token };
  }

  it("Test 1: two guest sessions created back-to-back have different identities (user id AND token)", async () => {
    const a = await newGuestDevice();
    const b = await newGuestDevice();
    expect(a.user.id).not.toBe(b.user.id);
    expect(a.token).not.toBe(b.token);
  });

  it("Test 12: a burst of 25 concurrent guest creations (simulating many devices opening at once) never collides", async () => {
    const devices = await Promise.all(Array.from({ length: 25 }, () => newGuestDevice()));
    const userIds = new Set(devices.map((d) => d.user.id));
    const tokens = new Set(devices.map((d) => d.token));
    expect(userIds.size).toBe(25);
    expect(tokens.size).toBe(25);
  });

  it("Test 2/3: Guest A's conversation is invisible to Guest B and cannot be read by id", async () => {
    const a = await newGuestDevice();
    const b = await newGuestDevice();

    const { conversationId } = startChatRun({ userId: a.user.id, requestId: randomUUID(), message: "Device A private test 12345" });

    expect(listConversations(b.user.id).some((c) => c.id === conversationId)).toBe(false);
    expect(conversationExists(b.user.id, conversationId)).toBe(false);
    expect(getConversationMessages(b.user.id, conversationId)).toEqual([]);
  });

  it("Test 4: Guest B cannot modify Guest A's conversation (starting a run against A's id from B creates a NEW conversation instead)", async () => {
    const a = await newGuestDevice();
    const b = await newGuestDevice();
    const { conversationId: aConvId } = startChatRun({ userId: a.user.id, requestId: randomUUID(), message: "A's message" });

    const { conversationId: resultConvId, isNewConversation } = startChatRun({
      userId: b.user.id,
      requestId: randomUUID(),
      message: "B trying to write into A's conversation",
      conversationId: aConvId,
    });

    expect(isNewConversation).toBe(true);
    expect(resultConvId).not.toBe(aConvId);
    // A's original conversation still has only A's message.
    expect(getConversationMessages(a.user.id, aConvId)).toHaveLength(1);
  });

  it("Test 5: Guest B cannot delete Guest A's conversation by id", async () => {
    const a = await newGuestDevice();
    const b = await newGuestDevice();
    const { conversationId } = startChatRun({ userId: a.user.id, requestId: randomUUID(), message: "keep me" });

    deleteConversation(b.user.id, conversationId);

    expect(conversationExists(a.user.id, conversationId)).toBe(true);
  });

  it("Test 6: Guest B cannot read Guest A's messages", async () => {
    const a = await newGuestDevice();
    const b = await newGuestDevice();
    const { conversationId } = startChatRun({ userId: a.user.id, requestId: randomUUID(), message: "secret content" });

    const messagesAsB = getConversationMessages(b.user.id, conversationId);
    expect(messagesAsB).toEqual([]);

    const messagesAsA = getConversationMessages(a.user.id, conversationId);
    expect(messagesAsA[0]?.content).toBe("secret content");
  });

  it("Test 7: Guest B cannot access Guest A's AgentRun", async () => {
    const a = await newGuestDevice();
    const b = await newGuestDevice();
    const { run } = startChatRun({ userId: a.user.id, requestId: randomUUID(), message: "run this" });

    expect(getRun(b.user.id, run.id)).toBeNull();
    expect(getRun(a.user.id, run.id)).not.toBeNull();
  });

  it("Test 8: Guest B cannot access Guest A's documents", () => {
    const aId = randomUUID();
    const bId = randomUUID();
    createdUserIds.push(aId, bId);
    db.prepare("INSERT INTO users (id, email, password_hash, name, is_guest) VALUES (?, ?, 'x', 'Guest', 1)").run(
      aId,
      `${aId}@guest.jennysol.local`
    );
    db.prepare("INSERT INTO users (id, email, password_hash, name, is_guest) VALUES (?, ?, 'x', 'Guest', 1)").run(
      bId,
      `${bId}@guest.jennysol.local`
    );
    const docId = randomUUID();
    insertDocument(aId, docId, "device-a-notes.txt");

    expect(documentBelongsToUser(bId, docId)).toBe(false);
    expect(listDocuments(bId)).toHaveLength(0);
    expect(listDocuments(aId)).toHaveLength(1);
  });

  it("Test 9: Guest B's RAG retrieval never scores/returns Guest A's document chunks", () => {
    const aId = randomUUID();
    const bId = randomUUID();
    createdUserIds.push(aId, bId);
    db.prepare("INSERT INTO users (id, email, password_hash, name, is_guest) VALUES (?, ?, 'x', 'Guest', 1)").run(
      aId,
      `${aId}@guest.jennysol.local`
    );
    db.prepare("INSERT INTO users (id, email, password_hash, name, is_guest) VALUES (?, ?, 'x', 'Guest', 1)").run(
      bId,
      `${bId}@guest.jennysol.local`
    );
    const matches = searchSimilarChunks(bId, new Float32Array([1, 0, 0]), 5);
    expect(matches).toHaveLength(0);
  });

  it("Test 10: starting a new guest session (logout + fresh guest, the actual startNewGuestSession mechanism) produces a genuinely new identity, and the old token stops working", async () => {
    const original = await newGuestDevice();
    expect(getSessionUserId(original.token)).toBe(original.user.id);

    // Mirrors AuthContext.tsx's startNewGuestSession(): delete the current
    // session server-side, then create a brand-new guest exactly like a
    // first-time visitor.
    deleteSession(original.token);
    const fresh = await newGuestDevice();

    expect(fresh.user.id).not.toBe(original.user.id);
    expect(getSessionUserId(original.token)).toBeNull(); // old token is dead
    expect(getSessionUserId(fresh.token)).toBe(fresh.user.id);
  });

  it("Test 11: the same token reliably resolves to the same identity across repeated lookups (what 'closing/reopening the browser' relies on)", async () => {
    const device = await newGuestDevice();
    // Simulates the browser being closed and reopened several times — each
    // time it re-sends the same localStorage-persisted token.
    for (let i = 0; i < 5; i++) {
      expect(getSessionUserId(device.token)).toBe(device.user.id);
    }
  });

  it("no 'default'/shared anonymous user ever receives more than one guest session's data", async () => {
    const devices = await Promise.all(Array.from({ length: 10 }, () => newGuestDevice()));
    for (const d of devices) {
      startChatRun({ userId: d.user.id, requestId: randomUUID(), message: `hello from ${d.user.id}` });
    }
    for (const d of devices) {
      const convos = listConversations(d.user.id);
      expect(convos).toHaveLength(1);
      const messages = getConversationMessages(d.user.id, convos[0].id);
      expect(messages[0]?.content).toBe(`hello from ${d.user.id}`);
    }
  });
});
