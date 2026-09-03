import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";

export type ErrorLevel = "uncaughtException" | "unhandledRejection" | "server" | "client";

// Best-effort by design: a failure while logging an error must never itself
// crash the process or break the response the caller is already sending.
export function logError(
  level: ErrorLevel,
  message: string,
  opts: { stack?: string; path?: string; userId?: string } = {}
) {
  try {
    db.prepare(
      "INSERT INTO error_logs (id, level, message, stack, path, user_id) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(randomUUID(), level, message.slice(0, 4000), opts.stack?.slice(0, 8000) ?? null, opts.path ?? null, opts.userId ?? null);
  } catch (err) {
    console.error("Failed to write to error_logs (non-fatal):", err);
  }
}

export interface ErrorLogEntry {
  id: string;
  level: ErrorLevel;
  message: string;
  stack: string | null;
  path: string | null;
  userId: string | null;
  createdAt: string;
}

export function listRecentErrors(limit: number, offset: number): ErrorLogEntry[] {
  return db
    .prepare(
      `SELECT id, level, message, stack, path, user_id as userId, created_at as createdAt
       FROM error_logs ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .all(limit, offset) as ErrorLogEntry[];
}

export function countRecentErrors(sinceHours: number): number {
  const row = db
    .prepare(`SELECT COUNT(*) as count FROM error_logs WHERE created_at >= datetime('now', ?)`)
    .get(`-${sinceHours} hours`) as { count: number };
  return row.count;
}
