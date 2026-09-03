import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { logError } from "../services/errorLog.js";
import { optionalAuth } from "../middleware/auth.js";

export const errorsRouter = Router();

// Frontend crash reports — optionalAuth because a crash can happen before
// login (e.g. on the login page itself), and rate-limited since it's an
// unauthenticated write path (a broken client shouldn't be able to flood the
// table by retrying a failing report in a loop).
const reportLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });

const clientErrorSchema = z.object({
  message: z.string().min(1).max(2000),
  stack: z.string().max(8000).optional(),
  path: z.string().max(500).optional(),
});

errorsRouter.post("/client", reportLimiter, optionalAuth, (req, res) => {
  const parsed = clientErrorSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  logError("client", parsed.data.message, {
    stack: parsed.data.stack,
    path: parsed.data.path,
    userId: req.userId,
  });
  res.status(204).send();
});
