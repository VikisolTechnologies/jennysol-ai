import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { getConversationSummary, saveConversationSummary, renameConversation, listConversations } from "./conversationStore.js";

function makeUser(): string {
  const userId = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, 'x', 'Test User')").run(
    userId,
    `${userId}@example.test`
  );
  return userId;
}

function makeConversation(userId: string): string {
  const id = randomUUID();
  db.prepare("INSERT INTO conversations (id, user_id, title) VALUES (?, ?, 'Test')").run(id, userId);
  return id;
}

describe("conversation_summaries — user_id scoping (defense-in-depth hardening)", () => {
  let userIds: string[] = [];

  afterEach(() => {
    for (const id of userIds) db.prepare("DELETE FROM users WHERE id = ?").run(id); // cascades
    userIds = [];
  });

  it("a summary saved for the owning user is readable by that same user", () => {
    const userId = makeUser();
    userIds.push(userId);
    const conversationId = makeConversation(userId);

    saveConversationSummary(userId, conversationId, "Summary text.", 5);
    const row = getConversationSummary(userId, conversationId);

    expect(row).toEqual({ summary: "Summary text.", throughIndex: 5 });
  });

  it("a summary is invisible when looked up with the wrong user_id, even with the correct conversation_id", () => {
    const ownerId = makeUser();
    const otherId = makeUser();
    userIds.push(ownerId, otherId);
    const conversationId = makeConversation(ownerId);

    saveConversationSummary(ownerId, conversationId, "Owner's summary.", 5);
    const asOther = getConversationSummary(otherId, conversationId);

    // Falls back to the empty default rather than leaking the owner's text —
    // exactly the defense-in-depth this hardening exists for.
    expect(asOther).toEqual({ summary: "", throughIndex: 0 });
  });

  it("re-saving for the same conversation updates in place rather than creating a duplicate row", () => {
    const userId = makeUser();
    userIds.push(userId);
    const conversationId = makeConversation(userId);

    saveConversationSummary(userId, conversationId, "First version.", 5);
    saveConversationSummary(userId, conversationId, "Second version.", 10);

    const row = getConversationSummary(userId, conversationId);
    expect(row).toEqual({ summary: "Second version.", throughIndex: 10 });

    const count = db
      .prepare("SELECT COUNT(*) as n FROM conversation_summaries WHERE conversation_id = ?")
      .get(conversationId) as { n: number };
    expect(count.n).toBe(1);
  });
});

describe("renameConversation — ownership + title_source + sort stability", () => {
  let userIds: string[] = [];

  afterEach(() => {
    for (const id of userIds) db.prepare("DELETE FROM users WHERE id = ?").run(id); // cascades
    userIds = [];
  });

  it("the owner can rename their own conversation, and it's marked title_source='manual'", () => {
    const userId = makeUser();
    userIds.push(userId);
    const conversationId = makeConversation(userId);

    const ok = renameConversation(userId, conversationId, "China Trip Planning");

    expect(ok).toBe(true);
    const [conv] = listConversations(userId);
    expect(conv.title).toBe("China Trip Planning");
    expect(conv.titleSource).toBe("manual");
  });

  it("a non-owner cannot rename someone else's conversation (the WHERE clause is the real authorization, not the caller's ID alone)", () => {
    const ownerId = makeUser();
    const attackerId = makeUser();
    userIds.push(ownerId, attackerId);
    const conversationId = makeConversation(ownerId);

    const result = renameConversation(attackerId, conversationId, "Hijacked title");

    expect(result).toBe(false);
    const [conv] = listConversations(ownerId);
    expect(conv.title).toBe("Test"); // untouched — still the seeded default
    expect(conv.titleSource).toBe("auto");
  });

  it("renaming does not bump updated_at — a rename never reorders the sidebar's most-recently-active sort", () => {
    const userId = makeUser();
    userIds.push(userId);
    const conversationId = makeConversation(userId);
    const before = (
      db.prepare("SELECT updated_at as updatedAt FROM conversations WHERE id = ?").get(conversationId) as {
        updatedAt: string;
      }
    ).updatedAt;

    renameConversation(userId, conversationId, "Renamed");

    const after = (
      db.prepare("SELECT updated_at as updatedAt FROM conversations WHERE id = ?").get(conversationId) as {
        updatedAt: string;
      }
    ).updatedAt;
    expect(after).toBe(before);
  });

  it("a brand-new conversation defaults to title_source='auto' before any rename", () => {
    const userId = makeUser();
    userIds.push(userId);
    makeConversation(userId);

    const [conv] = listConversations(userId);
    expect(conv.titleSource).toBe("auto");
  });
});
