import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "../../db/index.js";
import {
  createSession,
  getSessionUserId,
  deleteExpiredSessions,
  extendSessionToFullTtl,
  deleteSessionByFingerprint,
  fingerprint,
  listSessionsForUser,
} from "./sessions.js";

function makeUser(isGuest: boolean): string {
  const userId = randomUUID();
  db.prepare(
    "INSERT INTO users (id, email, password_hash, name, is_guest) VALUES (?, ?, 'x', 'Test User', ?)"
  ).run(userId, `${userId}@example.test`, isGuest ? 1 : 0);
  return userId;
}

function expiresAtFor(token: string): number {
  const row = db.prepare("SELECT expires_at as expiresAt FROM sessions WHERE id = ?").get(token) as {
    expiresAt: string;
  };
  return new Date(row.expiresAt).getTime();
}

describe("session TTL — guest vs full account", () => {
  const createdUserIds: string[] = [];
  afterEach(() => {
    for (const id of createdUserIds) db.prepare("DELETE FROM users WHERE id = ?").run(id); // cascades
    createdUserIds.length = 0;
  });

  it("a guest session gets a short (~24h) initial expiry, not the 30-day full-account TTL", () => {
    const userId = makeUser(true);
    createdUserIds.push(userId);
    const { token, expiresAt } = createSession(userId, "test-ua", true);

    const hoursUntilExpiry = (new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60);
    expect(hoursUntilExpiry).toBeGreaterThan(23);
    expect(hoursUntilExpiry).toBeLessThan(25);
    expect(getSessionUserId(token)).toBe(userId); // sanity: it's still valid right now
  });

  it("a full-account session keeps the existing ~30-day TTL, unchanged by this work", () => {
    const userId = makeUser(false);
    createdUserIds.push(userId);
    const { expiresAt } = createSession(userId, "test-ua", false);

    const daysUntilExpiry = (new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    expect(daysUntilExpiry).toBeGreaterThan(29);
    expect(daysUntilExpiry).toBeLessThan(31);
  });

  it("createSession defaults to full-account TTL when isGuest is omitted (backward compatible)", () => {
    const userId = makeUser(false);
    createdUserIds.push(userId);
    const { expiresAt } = createSession(userId, "test-ua");
    const daysUntilExpiry = (new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    expect(daysUntilExpiry).toBeGreaterThan(29);
  });

  it("using a guest session slides its expiry forward (active use keeps it alive)", () => {
    const userId = makeUser(true);
    createdUserIds.push(userId);
    const { token } = createSession(userId, "test-ua", true);
    const initialExpiry = expiresAtFor(token);

    // Force the stored expiry artificially close so a real sliding-window
    // extension is unambiguous in a fast-running test. Written as a proper
    // ISO8601 string via JS's Date, matching what the real code always
    // writes — SQLite's own datetime('now', ...) produces a space-
    // separated, no-'Z' string that JS's Date constructor parses as LOCAL
    // time rather than UTC, which silently breaks any comparison against
    // Date.now() depending on the machine's timezone.
    db.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").run(
      new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      token
    );
    expect(expiresAtFor(token)).toBeLessThan(initialExpiry);

    getSessionUserId(token); // one "active use"
    const afterUse = expiresAtFor(token);
    expect(afterUse).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000); // back to ~24h out
  });

  it("does NOT slide a full-account session's expiry on use (existing behavior, unchanged)", () => {
    const userId = makeUser(false);
    createdUserIds.push(userId);
    const { token } = createSession(userId, "test-ua", false);
    const before = expiresAtFor(token);

    getSessionUserId(token);
    expect(expiresAtFor(token)).toBe(before);
  });

  it("an expired session is rejected and deleted on access", () => {
    const userId = makeUser(true);
    createdUserIds.push(userId);
    const { token } = createSession(userId, "test-ua", true);
    db.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").run(
      new Date(Date.now() - 60 * 1000).toISOString(),
      token
    );

    expect(getSessionUserId(token)).toBeNull();
    expect(db.prepare("SELECT 1 FROM sessions WHERE id = ?").get(token)).toBeUndefined();
  });

  it("deleteExpiredSessions removes only already-expired rows, never a still-valid one", () => {
    const guestId = makeUser(true);
    const fullId = makeUser(false);
    createdUserIds.push(guestId, fullId);

    const expired = createSession(guestId, "test-ua", true);
    db.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").run(
      new Date(Date.now() - 60 * 1000).toISOString(),
      expired.token
    );
    const stillValid = createSession(fullId, "test-ua", false);

    deleteExpiredSessions();

    expect(db.prepare("SELECT 1 FROM sessions WHERE id = ?").get(expired.token)).toBeUndefined();
    expect(db.prepare("SELECT 1 FROM sessions WHERE id = ?").get(stillValid.token)).toBeDefined();
  });

  it("extendSessionToFullTtl (the guest-upgrade path) pushes a short guest expiry back out to the full 30-day window", () => {
    const userId = makeUser(true);
    createdUserIds.push(userId);
    const { token } = createSession(userId, "test-ua", true);

    extendSessionToFullTtl(token);

    const daysUntilExpiry = (expiresAtFor(token) - Date.now()) / (1000 * 60 * 60 * 24);
    expect(daysUntilExpiry).toBeGreaterThan(29);
  });
});

// Added 2026-09-10 for the new Security/Sessions page's per-row "revoke this
// device" action — the fingerprint returned by listSessionsForUser is a
// deliberate one-way hash (never the raw token), so this is the reverse
// lookup that has to happen server-side without ever exposing a real token.
describe("deleteSessionByFingerprint — per-row revoke for the Sessions UI", () => {
  const createdUserIds: string[] = [];
  afterEach(() => {
    for (const id of createdUserIds) db.prepare("DELETE FROM users WHERE id = ?").run(id);
    createdUserIds.length = 0;
  });

  it("revokes exactly the session matching the given fingerprint, leaving others untouched", () => {
    const userId = makeUser(false);
    createdUserIds.push(userId);
    const a = createSession(userId, "chrome-mac");
    const b = createSession(userId, "safari-iphone");

    const revoked = deleteSessionByFingerprint(userId, fingerprint(a.token));

    expect(revoked).toBe(true);
    expect(getSessionUserId(a.token)).toBeNull();
    expect(getSessionUserId(b.token)).toBe(userId);
  });

  it("returns false and deletes nothing for a fingerprint that doesn't match any of this user's sessions", () => {
    const userId = makeUser(false);
    createdUserIds.push(userId);
    const { token } = createSession(userId, "chrome-mac");

    const revoked = deleteSessionByFingerprint(userId, "0000deadbeef");

    expect(revoked).toBe(false);
    expect(getSessionUserId(token)).toBe(userId);
  });

  it("never matches a fingerprint against a DIFFERENT user's session, even if that user's session id happens to be known", () => {
    const userA = makeUser(false);
    const userB = makeUser(false);
    createdUserIds.push(userA, userB);
    const bSession = createSession(userB, "victim-device");

    const revoked = deleteSessionByFingerprint(userA, fingerprint(bSession.token));

    expect(revoked).toBe(false);
    expect(getSessionUserId(bSession.token)).toBe(userB); // untouched
  });

  it("listSessionsForUser's fingerprint output is exactly what deleteSessionByFingerprint expects (no drift between the two)", () => {
    const userId = makeUser(false);
    createdUserIds.push(userId);
    const { token } = createSession(userId, "chrome-mac");

    const [summary] = listSessionsForUser(userId);
    const revoked = deleteSessionByFingerprint(userId, summary.fingerprint);

    expect(revoked).toBe(true);
  });
});
