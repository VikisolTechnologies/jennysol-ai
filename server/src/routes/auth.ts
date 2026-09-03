import { Router } from "express";
import { randomBytes } from "node:crypto";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { checkPasswordStrength, hashPassword, verifyPassword } from "../services/auth/password.js";
import {
  createSession,
  deleteAllSessionsForUser,
  deleteOtherSessions,
  deleteSession,
  listSessionsForUser,
} from "../services/auth/sessions.js";
import { isLockedOut, recordLoginAttempt } from "../services/auth/loginAttempts.js";
import {
  ROLES,
  createEmailVerificationToken,
  createPasswordResetToken,
  createUser,
  createUserFromGoogle,
  consumeEmailVerificationToken,
  consumePasswordResetToken,
  getPasswordHash,
  getUserByEmail,
  getUserByGoogleId,
  getUserById,
  linkGoogleId,
  markEmailVerified,
  markWelcomeSeen,
  setPasswordHash,
  updateProfile,
} from "../services/auth/userStore.js";
import { verifyGoogleCredential } from "../services/auth/google.js";
import { sendEmail } from "../services/email.js";
import { requireAuth } from "../middleware/auth.js";

export const authRouter = Router();

// Applied only to the specific endpoints an attacker could actually abuse
// (credential guessing, account-creation spam, reset-token spam) — not the
// whole router, so a logged-in client polling /me doesn't get throttled.
const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const emailSchema = z.string().trim().toLowerCase().email();

function frontendUrl(): string {
  return process.env.FRONTEND_URL || "http://localhost:5173";
}

// ---- Signup ----

const signupSchema = z.object({
  email: emailSchema,
  password: z.string(),
  name: z.string().trim().min(1).max(200),
  role: z.enum(ROLES).default("candidate"),
});

authRouter.post("/signup", sensitiveLimiter, async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { email, password, name, role } = parsed.data;

  const strength = checkPasswordStrength(password);
  if (!strength.ok) {
    res.status(400).json({ error: strength.reason });
    return;
  }

  if (getUserByEmail(email)) {
    // Same generic message an unknown-account login gets — don't let signup
    // double as an account-enumeration oracle either.
    res.status(409).json({ error: "That email can't be used. Try logging in instead." });
    return;
  }

  const passwordHash = await hashPassword(password);
  const user = createUser(email, passwordHash, name, role);

  const verifyToken = createEmailVerificationToken(user.id);
  await sendEmail(
    email,
    "Verify your Jennysol AI account",
    `Hi ${name},\n\nVerify your email: ${frontendUrl()}/verify-email?token=${verifyToken}\n\nThis link expires in 24 hours.`
  );

  const { token, expiresAt } = createSession(user.id, req.header("user-agent"));
  res.status(201).json({ token, expiresAt, user });
});

// ---- Login ----

const loginSchema = z.object({
  email: emailSchema,
  password: z.string(),
});

authRouter.post("/login", sensitiveLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const { email, password } = parsed.data;

  if (isLockedOut(email)) {
    res.status(429).json({ error: "Too many failed attempts. Try again in a few minutes." });
    return;
  }

  const record = getUserByEmail(email);
  const valid = record ? await verifyPassword(password, record.passwordHash) : false;
  recordLoginAttempt(email, req.ip, valid);

  if (!record || !valid) {
    res.status(401).json({ error: "Incorrect email or password." });
    return;
  }

  const { token, expiresAt } = createSession(record.id, req.header("user-agent"));
  const { passwordHash: _passwordHash, ...user } = record;
  res.json({ token, expiresAt, user });
});

// ---- Sign in with Google ----

const googleSchema = z.object({ credential: z.string().min(1) });

authRouter.post("/google", sensitiveLimiter, async (req, res) => {
  const parsed = googleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  if (!process.env.GOOGLE_CLIENT_ID) {
    res.status(500).json({ error: "Google sign-in isn't set up on this server yet." });
    return;
  }

  const profile = await verifyGoogleCredential(parsed.data.credential);
  if (!profile) {
    res.status(401).json({ error: "That Google sign-in couldn't be verified. Please try again." });
    return;
  }

  // Three cases: (1) this Google account has signed in before — log in
  // directly; (2) no google_id match, but the email already has a
  // password account — link Google to it rather than erroring, since it's
  // legitimately the same person; (3) genuinely new — create an account,
  // taking the display name Google gives us (the user can rename
  // themselves anytime in profile settings — no separate "what should we
  // call you" prompt needed for something that's already editable).
  let user = getUserByGoogleId(profile.googleId);
  if (!user) {
    const existingByEmail = getUserByEmail(profile.email);
    if (existingByEmail) {
      linkGoogleId(existingByEmail.id, profile.googleId);
      user = getUserById(existingByEmail.id)!;
    } else {
      const unusablePasswordHash = await hashPassword(randomBytes(32).toString("hex"));
      user = createUserFromGoogle(profile.email, unusablePasswordHash, profile.name, profile.googleId);
    }
  }

  const { token, expiresAt } = createSession(user.id, req.header("user-agent"));
  res.json({ token, expiresAt, user });
});

// ---- Logout ----

authRouter.post("/logout", requireAuth, (req, res) => {
  const header = req.header("authorization")!;
  deleteSession(header.slice("Bearer ".length).trim());
  res.status(204).send();
});

authRouter.post("/logout-all", requireAuth, (req, res) => {
  deleteAllSessionsForUser(req.userId!);
  res.status(204).send();
});

authRouter.get("/sessions", requireAuth, (req, res) => {
  res.json({ sessions: listSessionsForUser(req.userId!) });
});

// ---- Current user / profile ----

authRouter.get("/me", requireAuth, (req, res) => {
  const user = getUserById(req.userId!);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ user });
});

authRouter.post("/mark-welcome-seen", requireAuth, (req, res) => {
  markWelcomeSeen(req.userId!);
  res.status(204).send();
});

const profileSchema = z.object({ name: z.string().trim().min(1).max(200) });

authRouter.patch("/profile", requireAuth, (req, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const user = updateProfile(req.userId!, parsed.data);
  res.json({ user });
});

// ---- Change password (while logged in) ----

const changePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string(),
  logoutOtherSessions: z.boolean().default(true),
});

authRouter.post("/change-password", requireAuth, async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const passwordHash = getPasswordHash(req.userId!);
  if (!passwordHash) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const valid = await verifyPassword(parsed.data.currentPassword, passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Current password is incorrect." });
    return;
  }
  const strength = checkPasswordStrength(parsed.data.newPassword);
  if (!strength.ok) {
    res.status(400).json({ error: strength.reason });
    return;
  }
  setPasswordHash(req.userId!, await hashPassword(parsed.data.newPassword));
  if (parsed.data.logoutOtherSessions) {
    const currentToken = req.header("authorization")!.slice("Bearer ".length).trim();
    deleteOtherSessions(req.userId!, currentToken);
  }
  res.status(204).send();
});

// ---- Forgot / reset password ----

const forgotPasswordSchema = z.object({ email: emailSchema });

authRouter.post("/forgot-password", sensitiveLimiter, async (req, res) => {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const user = getUserByEmail(parsed.data.email);
  // Always the same response whether or not the account exists — the
  // alternative ("no account with that email") is a textbook account-
  // enumeration leak.
  if (user) {
    const token = createPasswordResetToken(user.id);
    await sendEmail(
      user.email,
      "Reset your Jennysol AI password",
      `Reset your password: ${frontendUrl()}/reset-password?token=${token}\n\nThis link expires in 30 minutes. If you didn't request this, ignore this email.`
    );
  }
  res.json({ message: "If an account with that email exists, a reset link has been sent." });
});

const resetPasswordSchema = z.object({ token: z.string(), newPassword: z.string() });

authRouter.post("/reset-password", sensitiveLimiter, async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const strength = checkPasswordStrength(parsed.data.newPassword);
  if (!strength.ok) {
    res.status(400).json({ error: strength.reason });
    return;
  }
  const userId = consumePasswordResetToken(parsed.data.token);
  if (!userId) {
    res.status(400).json({ error: "That reset link is invalid or has expired." });
    return;
  }
  setPasswordHash(userId, await hashPassword(parsed.data.newPassword));
  deleteAllSessionsForUser(userId); // a password reset invalidates every existing session, including a possible attacker's
  res.status(204).send();
});

// ---- Email verification ----

authRouter.post("/verify-email", async (req, res) => {
  const parsed = z.object({ token: z.string() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const userId = consumeEmailVerificationToken(parsed.data.token);
  if (!userId) {
    res.status(400).json({ error: "That verification link is invalid or has expired." });
    return;
  }
  markEmailVerified(userId);
  res.status(204).send();
});

authRouter.post("/resend-verification", requireAuth, async (req, res) => {
  const user = getUserById(req.userId!);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (user.emailVerified) {
    res.status(204).send();
    return;
  }
  const token = createEmailVerificationToken(user.id);
  await sendEmail(
    user.email,
    "Verify your Jennysol AI account",
    `Verify your email: ${frontendUrl()}/verify-email?token=${token}\n\nThis link expires in 24 hours.`
  );
  res.status(204).send();
});
