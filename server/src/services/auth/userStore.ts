import { randomBytes, randomUUID } from "node:crypto";
import { db } from "../../db/index.js";

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
  createdAt: string;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  organizationId: string | null;
  emailVerified: number;
  createdAt: string;
}

function toUser(row: UserRow): User {
  return { ...row, emailVerified: !!row.emailVerified };
}

export function createUser(email: string, passwordHash: string, name: string, role: Role): User {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)"
  ).run(id, email.toLowerCase(), passwordHash, name, role);
  return getUserById(id)!;
}

export function getUserByEmail(email: string): (User & { passwordHash: string }) | null {
  const row = db
    .prepare(
      `SELECT id, email, password_hash as passwordHash, name, role, organization_id as organizationId,
              email_verified as emailVerified, created_at as createdAt
       FROM users WHERE email = ?`
    )
    .get(email.toLowerCase()) as (UserRow & { passwordHash: string }) | undefined;
  if (!row) return null;
  return { ...toUser(row), passwordHash: row.passwordHash };
}

export function getUserById(id: string): User | null {
  const row = db
    .prepare(
      `SELECT id, email, name, role, organization_id as organizationId,
              email_verified as emailVerified, created_at as createdAt
       FROM users WHERE id = ?`
    )
    .get(id) as UserRow | undefined;
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
