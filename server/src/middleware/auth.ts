import type { NextFunction, Request, Response } from "express";
import { getSessionUserId } from "../services/auth/sessions.js";

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
// when not (none currently use this, kept for the routes that will).
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (token) {
    const userId = getSessionUserId(token);
    if (userId) req.userId = userId;
  }
  next();
}
