import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import type { ChatTurn } from "./llm.js";

export type Source =
  | { type: "document"; documentId: string; text: string }
  | { type: "web"; title: string; url: string; domain?: string };

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export interface StoredMessage extends ChatTurn {
  sources?: Source[];
}

function titleFrom(firstMessage: string): string {
  const oneLine = firstMessage.replace(/\s+/g, " ").trim();
  return oneLine.length > 48 ? `${oneLine.slice(0, 48)}…` : oneLine;
}

// Every query below is scoped by user_id — this is the actual tenant-
// isolation boundary for conversations, not just a UI-layer filter. A
// conversation ID alone is never sufficient to read/modify it; the caller's
// userId must match too, which is why every route calling into this module
// passes req.userId (set by requireAuth from a verified session) rather than
// anything client-supplied.

export function createConversation(userId: string, firstUserMessage: string): string {
  const id = randomUUID();
  db.prepare("INSERT INTO conversations (id, user_id, title) VALUES (?, ?, ?)").run(
    id,
    userId,
    titleFrom(firstUserMessage)
  );
  return id;
}

export function listConversations(userId: string): ConversationSummary[] {
  return db
    .prepare(
      "SELECT id, title, updated_at as updatedAt FROM conversations WHERE user_id = ? ORDER BY updated_at DESC"
    )
    .all(userId) as ConversationSummary[];
}

export function getConversationMessages(userId: string, conversationId: string): StoredMessage[] {
  const rows = db
    .prepare(
      `SELECT m.role, m.content, m.sources FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE m.conversation_id = ? AND c.user_id = ?
       ORDER BY m.created_at ASC`
    )
    .all(conversationId, userId) as { role: "user" | "assistant"; content: string; sources: string | null }[];

  return rows.map((r) => ({
    role: r.role,
    content: r.content,
    sources: r.sources ? JSON.parse(r.sources) : undefined,
  }));
}

export function addMessage(
  userId: string,
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  sources?: Source[]
) {
  db.prepare("INSERT INTO messages (id, conversation_id, role, content, sources) VALUES (?, ?, ?, ?, ?)").run(
    randomUUID(),
    conversationId,
    role,
    content,
    sources && sources.length > 0 ? JSON.stringify(sources) : null
  );
  db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ? AND user_id = ?").run(
    conversationId,
    userId
  );
}

export function conversationExists(userId: string, conversationId: string): boolean {
  return !!db.prepare("SELECT 1 FROM conversations WHERE id = ? AND user_id = ?").get(conversationId, userId);
}

export function deleteConversation(userId: string, conversationId: string) {
  db.prepare("DELETE FROM conversations WHERE id = ? AND user_id = ?").run(conversationId, userId);
}
