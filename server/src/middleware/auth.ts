import type { NextFunction, Request, Response } from "express";
import { getSessionUserId } from "../services/auth/sessions.js";
import { getUserById } from "../services/auth/userStore.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

function extractToken(req: Request): string | null {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  const userId = token ? getSessionUserId(token) : null;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  req.userId = userId;
  next();
}

// For routes that behave differently when logged in but shouldn't hard-fail
// when not (used by the client crash-report endpoint, which can fire before
// login).
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (token) {
    const userId = getSessionUserId(token);
    if (userId) req.userId = userId;
  }
  next();
}

// Must run after requireAuth (needs req.userId already set). Checks the
// role fresh from the DB on every request rather than trusting a claim
// baked into the session token, so revoking admin access takes effect
// immediately rather than only after the session expires.
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = req.userId ? getUserById(req.userId) : null;
  if (!user || user.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}
