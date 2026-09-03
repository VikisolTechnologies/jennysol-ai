import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import type { ChatTurn } from "./llm.js";

export interface Source {
  documentId: string;
  text: string;
}

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

export function createConversation(firstUserMessage: string): string {
  const id = randomUUID();
  db.prepare("INSERT INTO conversations (id, title) VALUES (?, ?)").run(id, titleFrom(firstUserMessage));
  return id;
}

export function listConversations(): ConversationSummary[] {
  return db
    .prepare("SELECT id, title, updated_at as updatedAt FROM conversations ORDER BY updated_at DESC")
    .all() as ConversationSummary[];
}

export function getConversationMessages(conversationId: string): StoredMessage[] {
  const rows = db
    .prepare("SELECT role, content, sources FROM messages WHERE conversation_id = ? ORDER BY created_at ASC")
    .all(conversationId) as { role: "user" | "assistant"; content: string; sources: string | null }[];

  return rows.map((r) => ({
    role: r.role,
    content: r.content,
    sources: r.sources ? JSON.parse(r.sources) : undefined,
  }));
}

export function addMessage(
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
  db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(conversationId);
}

export function conversationExists(conversationId: string): boolean {
  return !!db.prepare("SELECT 1 FROM conversations WHERE id = ?").get(conversationId);
}

export function deleteConversation(conversationId: string) {
  db.prepare("DELETE FROM conversations WHERE id = ?").run(conversationId);
}
