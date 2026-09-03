import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number
) => Promise<Buffer>;

const KEY_LENGTH = 64;

// No bcrypt/argon2 dependency needed — Node's own scrypt is a well-regarded,
// deliberately slow KDF built for exactly this. Stored as "salt:hash" hex.
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scryptAsync(password, salt, KEY_LENGTH);
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hashHex] = stored.split(":");
  if (!salt || !hashHex) return false;
  const derived = await scryptAsync(password, salt, KEY_LENGTH);
  const storedBuf = Buffer.from(hashHex, "hex");
  if (storedBuf.length !== derived.length) return false;
  return timingSafeEqual(derived, storedBuf); // constant-time, avoids a timing side-channel
}

export interface PasswordStrengthResult {
  ok: boolean;
  reason?: string;
}

export function checkPasswordStrength(password: string): PasswordStrengthResult {
  if (password.length < 10) return { ok: false, reason: "Password must be at least 10 characters." };
  if (password.length > 200) return { ok: false, reason: "Password is too long." };
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return { ok: false, reason: "Password must include upper and lower case letters and a number." };
  }
  return { ok: true };
}
