import { randomBytes, createHash } from "node:crypto";
import { db } from "../../db/index.js";

const SESSION_TTL_DAYS = 30;

// A guest identity is "the current browser session" (see client's
// storageKeys.ts / auth.ts — the token lives in sessionStorage, not
// localStorage, so it's gone the moment the browser/tab actually closes).
// The server can't observe that close directly, so this is the backstop:
// an idle-timeout, refreshed on every real use (see the sliding-window
// UPDATE in getSessionUserId below) rather than a fixed expiry from
// creation — a guest actively chatting for hours never gets cut off
// mid-conversation, but one that's genuinely been abandoned becomes
// unreachable within this window even if the tab is somehow still open.
const GUEST_SESSION_TTL_HOURS = 24;

export interface SessionUser {
  userId: string;
}

function guestExpiry(): string {
  return new Date(Date.now() + GUEST_SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString();
}

// Opaque, DB-backed session tokens rather than stateless JWTs — deliberately,
// so "logout everywhere" and per-session revocation are a real DELETE, not a
// blocklist bolted on afterward. The token itself is the primary key: 32
// random bytes is unguessable, no separate secret/signing needed.
//
// `isGuest` controls the initial expiry only — a full account keeps the
// existing fixed 30-day-from-creation TTL (unchanged behavior), a guest
// gets the short sliding TTL above. Passed explicitly by the caller
// (routes/auth.ts's /guest endpoint) rather than inferred here, since this
// module has no reason to know about the users table's shape.
export function createSession(
  userId: string,
  userAgent?: string,
  isGuest = false
): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString("hex");
  const expiresAt = isGuest
    ? guestExpiry()
    : new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
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
    .prepare(
      `SELECT s.user_id as userId, s.expires_at as expiresAt, u.is_guest as isGuest
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`
    )
    .get(token) as { userId: string; expiresAt: string; isGuest: number } | undefined;
  if (!row) return null;
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(token);
    return null;
  }
  // Sliding window for guests (see GUEST_SESSION_TTL_HOURS above); full
  // accounts keep their fixed expires_at untouched — same as before this
  // change, not something this task asked to alter.
  if (row.isGuest) {
    db.prepare("UPDATE sessions SET last_used_at = datetime('now'), expires_at = ? WHERE id = ?").run(
      guestExpiry(),
      token
    );
  } else {
    db.prepare("UPDATE sessions SET last_used_at = datetime('now') WHERE id = ?").run(token);
  }
  return row.userId;
}

// Called when a guest upgrades to a full account (routes/auth.ts's
// /upgrade) — without this, the session row keeps whatever short guest
// expiry it last had (see getSessionUserId's sliding window), and since
// the sliding refresh only fires for sessions still flagged is_guest, a
// freshly-upgraded account would silently stop being kept alive and log
// itself out within GUEST_SESSION_TTL_HOURS despite now being a real,
// supposed-to-persist account. Same session token throughout — this only
// touches expires_at, never issues a new one.
export function extendSessionToFullTtl(token: string): void {
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").run(expiresAt, token);
}

// Safe by construction: only ever removes rows already past expires_at —
// an already-inaccessible session (getSessionUserId would already refuse
// it) — never an active one. Called on a plain interval from index.ts, not
// triggered by any request, so it can't race a real login.
//
// Compares against a JS-computed ISO8601 timestamp bound as a parameter,
// not SQLite's own datetime('now') — every expires_at value the app ever
// writes is a JS .toISOString() string (T-separated, Z-suffixed);
// SQLite's datetime('now') produces a differently-formatted string
// (space-separated, no Z), and comparing the two as plain TEXT only
// happens to sort correctly when their date portions already differ,
// which is true for realistic TTLs but isn't a real guarantee — matching
// formats removes the question entirely.
export function deleteExpiredSessions(): number {
  const result = db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date().toISOString());
  return result.changes;
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
