import { randomBytes, createHash } from "node:crypto";
import { db } from "../../db/index.js";

const SESSION_TTL_DAYS = 30;

export interface SessionUser {
  userId: string;
}

// Opaque, DB-backed session tokens rather than stateless JWTs — deliberately,
// so "logout everywhere" and per-session revocation are a real DELETE, not a
// blocklist bolted on afterward. The token itself is the primary key: 32
// random bytes is unguessable, no separate secret/signing needed.
export function createSession(userId: string, userAgent?: string): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare("INSERT INTO sessions (id, user_id, user_agent, expires_at) VALUES (?, ?, ?, ?)").run(
    token,
    userId,
    userAgent ?? null,
    expiresAt
  );
  return { token, expiresAt };
}

export function getSessionUserId(token: string): string | null {
  const row = db
    .prepare("SELECT user_id as userId, expires_at as expiresAt FROM sessions WHERE id = ?")
    .get(token) as { userId: string; expiresAt: string } | undefined;
  if (!row) return null;
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(token);
    return null;
  }
  db.prepare("UPDATE sessions SET last_used_at = datetime('now') WHERE id = ?").run(token);
  return row.userId;
}

export function deleteSession(token: string) {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(token);
}

export function deleteAllSessionsForUser(userId: string) {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

export function deleteOtherSessions(userId: string, keepToken: string) {
  db.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").run(userId, keepToken);
}

export interface SessionSummary {
  // A safe, non-reversible fingerprint — never the raw token. `sessions.id`
  // in the schema IS the bearer token itself (see createSession above), so
  // this previously returned a live, replayable credential to any client
  // that called GET /api/auth/sessions. Not currently called from the
  // frontend (verified — no "manage devices" UI exists yet), but fixed now
  // rather than left as a live token-exposure endpoint waiting for someone
  // to wire a UI to it later.
  fingerprint: string;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string;
}

function fingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 12);
}

export function listSessionsForUser(userId: string): SessionSummary[] {
  const rows = db
    .prepare(
      `SELECT id, user_agent as userAgent, created_at as createdAt, last_used_at as lastUsedAt
       FROM sessions WHERE user_id = ? ORDER BY last_used_at DESC`
    )
    .all(userId) as { id: string; userAgent: string | null; createdAt: string; lastUsedAt: string }[];
  return rows.map(({ id, ...rest }) => ({ fingerprint: fingerprint(id), ...rest }));
}
