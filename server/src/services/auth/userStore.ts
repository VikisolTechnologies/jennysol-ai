import { randomBytes, randomUUID } from "node:crypto";
import { db } from "../../db/index.js";
import { hashPassword } from "./password.js";

export const ROLES = [
  "candidate",
  "recruiter",
  "business",
  "software_company",
  "freelancer",
  "university",
  "training_institute",
  "admin",
] as const;
export type Role = (typeof ROLES)[number];

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  organizationId: string | null;
  emailVerified: boolean;
  authProvider: string;
  hasSeenWelcome: boolean;
  isGuest: boolean;
  createdAt: string;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  organizationId: string | null;
  emailVerified: number;
  authProvider: string;
  hasSeenWelcome: number;
  isGuest: number;
  createdAt: string;
}

function toUser(row: UserRow): User {
  return { ...row, emailVerified: !!row.emailVerified, hasSeenWelcome: !!row.hasSeenWelcome, isGuest: !!row.isGuest };
}

const USER_SELECT = `
  SELECT id, email, name, role, organization_id as organizationId, email_verified as emailVerified,
         auth_provider as authProvider, has_seen_welcome as hasSeenWelcome, is_guest as isGuest,
         created_at as createdAt
  FROM users
`;

export function createUser(email: string, passwordHash: string, name: string, role: Role): User {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO users (id, email, password_hash, name, role, auth_provider) VALUES (?, ?, ?, ?, ?, 'password')"
  ).run(id, email.toLowerCase(), passwordHash, name, role);
  return getUserById(id)!;
}

// Google sign-ins skip our own password/verification flow entirely — Google
// has already verified the email, and there's no password to check, ever.
// The stored hash is an unguessable random value purely to satisfy the
// column's NOT NULL constraint; nothing ever compares against it.
export function createUserFromGoogle(email: string, unusablePasswordHash: string, name: string, googleId: string): User {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO users (id, email, password_hash, name, role, google_id, auth_provider, email_verified)
     VALUES (?, ?, ?, ?, 'candidate', ?, 'google', 1)`
  ).run(id, email.toLowerCase(), unusablePasswordHash, name, googleId);
  return getUserById(id)!;
}

// A synthetic, unguessable email (never shown to anyone, never used to log
// in — a guest doesn't know it exists) purely to satisfy the `email`
// column's NOT NULL/UNIQUE constraint, same idea as the unusable password
// hash Google sign-ins already use above. hashPassword is still run over a
// random value rather than storing raw bytes, so this row is
// indistinguishable in shape from any other user's — nothing downstream
// (verifyPassword, exports, etc.) needs to special-case it.
export async function createGuestUser(): Promise<User> {
  const id = randomUUID();
  const email = `guest-${id}@guest.jennysol.local`;
  const unusablePasswordHash = await hashPassword(randomBytes(32).toString("hex"));
  db.prepare(
    `INSERT INTO users (id, email, password_hash, name, role, auth_provider, is_guest, email_verified)
     VALUES (?, ?, ?, 'Guest', 'candidate', 'guest', 1, 1)`
  ).run(id, email, unusablePasswordHash);
  return getUserById(id)!;
}

// Upgrades a guest account to a full one **in place** — same row, same id,
// same session token — rather than creating a new user and migrating data.
// This is the entire mechanism behind "signing up saves your guest chat
// history": every conversation/message/document is already foreign-keyed to
// this user's id, so nothing needs to move.
export function upgradeGuestToFullAccount(id: string, email: string, passwordHash: string, name: string): User {
  db.prepare(
    `UPDATE users SET email = ?, password_hash = ?, name = ?, auth_provider = 'password', is_guest = 0,
     updated_at = datetime('now') WHERE id = ?`
  ).run(email.toLowerCase(), passwordHash, name, id);
  return getUserById(id)!;
}

export function getUserByGoogleId(googleId: string): User | null {
  const row = db.prepare(`${USER_SELECT} WHERE google_id = ?`).get(googleId) as UserRow | undefined;
  return row ? toUser(row) : null;
}

export function linkGoogleId(userId: string, googleId: string) {
  db.prepare("UPDATE users SET google_id = ?, updated_at = datetime('now') WHERE id = ?").run(googleId, userId);
}

export function markWelcomeSeen(userId: string) {
  db.prepare("UPDATE users SET has_seen_welcome = 1, updated_at = datetime('now') WHERE id = ?").run(userId);
}

export function getUserByEmail(email: string): (User & { passwordHash: string }) | null {
  const row = db
    .prepare(`SELECT id, email, password_hash as passwordHash, name, role, organization_id as organizationId,
              email_verified as emailVerified, auth_provider as authProvider, has_seen_welcome as hasSeenWelcome,
              is_guest as isGuest, created_at as createdAt FROM users WHERE email = ?`)
    .get(email.toLowerCase()) as (UserRow & { passwordHash: string }) | undefined;
  if (!row) return null;
  return { ...toUser(row), passwordHash: row.passwordHash };
}

export function getUserById(id: string): User | null {
  const row = db.prepare(`${USER_SELECT} WHERE id = ?`).get(id) as UserRow | undefined;
  return row ? toUser(row) : null;
}

export function updateProfile(id: string, fields: { name?: string }): User | null {
  if (fields.name !== undefined) {
    db.prepare("UPDATE users SET name = ?, updated_at = datetime('now') WHERE id = ?").run(fields.name, id);
  }
  return getUserById(id);
}

export function getPasswordHash(id: string): string | null {
  const row = db.prepare("SELECT password_hash as passwordHash FROM users WHERE id = ?").get(id) as
    | { passwordHash: string }
    | undefined;
  return row?.passwordHash ?? null;
}

export function setPasswordHash(id: string, passwordHash: string) {
  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(
    passwordHash,
    id
  );
}

export function markEmailVerified(id: string) {
  db.prepare("UPDATE users SET email_verified = 1, updated_at = datetime('now') WHERE id = ?").run(id);
}

// --- Password reset tokens ---

const RESET_TOKEN_TTL_MINUTES = 30;

export function createPasswordResetToken(userId: string): string {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000).toISOString();
  db.prepare("INSERT INTO password_reset_tokens (token, user_id, expires_at) VALUES (?, ?, ?)").run(
    token,
    userId,
    expiresAt
  );
  return token;
}

export function consumePasswordResetToken(token: string): string | null {
  const row = db
    .prepare(
      "SELECT user_id as userId, expires_at as expiresAt, used_at as usedAt FROM password_reset_tokens WHERE token = ?"
    )
    .get(token) as { userId: string; expiresAt: string; usedAt: string | null } | undefined;
  if (!row || row.usedAt || new Date(row.expiresAt).getTime() < Date.now()) return null;
  db.prepare("UPDATE password_reset_tokens SET used_at = datetime('now') WHERE token = ?").run(token);
  return row.userId;
}

// --- Email verification tokens ---

const VERIFY_TOKEN_TTL_HOURS = 24;

export function createEmailVerificationToken(userId: string): string {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL_HOURS * 60 * 60 * 1000).toISOString();
  db.prepare("INSERT INTO email_verification_tokens (token, user_id, expires_at) VALUES (?, ?, ?)").run(
    token,
    userId,
    expiresAt
  );
  return token;
}

export function consumeEmailVerificationToken(token: string): string | null {
  const row = db
    .prepare(
      "SELECT user_id as userId, expires_at as expiresAt, used_at as usedAt FROM email_verification_tokens WHERE token = ?"
    )
    .get(token) as { userId: string; expiresAt: string; usedAt: string | null } | undefined;
  if (!row || row.usedAt || new Date(row.expiresAt).getTime() < Date.now()) return null;
  db.prepare("UPDATE email_verification_tokens SET used_at = datetime('now') WHERE token = ?").run(token);
  return row.userId;
}
