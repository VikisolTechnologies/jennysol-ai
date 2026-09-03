import { randomUUID } from "node:crypto";
import { db } from "../../db/index.js";

const WINDOW_MINUTES = 15;
const MAX_FAILURES_IN_WINDOW = 8;

export function recordLoginAttempt(email: string, ip: string | undefined, succeeded: boolean) {
  db.prepare("INSERT INTO login_attempts (id, email, ip, succeeded) VALUES (?, ?, ?, ?)").run(
    randomUUID(),
    email.toLowerCase(),
    ip ?? null,
    succeeded ? 1 : 0
  );
}

// Simple, DB-backed lockout: too many recent failures for this email pauses
// further attempts for the rest of the window, regardless of source IP —
// deliberately keyed on email, not IP, since IP alone is trivial to rotate.
export function isLockedOut(email: string): boolean {
  // login_attempts.created_at is SQLite's datetime('now') format
  // ("YYYY-MM-DD HH:MM:SS", space-separated, no ms/zone) — match it exactly,
  // since comparing that against a JS toISOString() string ("...T...Z") would
  // silently sort wrong.
  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
  const row = db
    .prepare(
      `SELECT COUNT(*) as failures FROM login_attempts
       WHERE email = ? AND succeeded = 0 AND created_at > ?`
    )
    .get(email.toLowerCase(), since) as { failures: number };
  return row.failures >= MAX_FAILURES_IN_WINDOW;
}
