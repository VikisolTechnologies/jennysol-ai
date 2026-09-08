import "dotenv/config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import path from "node:path";
import fs from "node:fs";
import { authRouter } from "./routes/auth.js";
import { chatRouter } from "./routes/chat.js";
import { conversationsRouter } from "./routes/conversations.js";
import { documentsRouter } from "./routes/documents.js";
import { imageRouter } from "./routes/image.js";
import { speechRouter } from "./routes/speech.js";
import { errorsRouter } from "./routes/errors.js";
import { adminRouter } from "./routes/admin.js";
import { agentRunsRouter } from "./routes/agentRuns.js";
import { requireAuth } from "./middleware/auth.js";
import { noProviderConfigured } from "./services/llm.js";
import { warmUpGemini } from "./services/providers/gemini.js";
import { logError } from "./services/errorLog.js";
import { BUILD_VERSION } from "./version.js";
import { deleteExpiredSessions } from "./services/auth/sessions.js";
import "./db/index.js";

// GIT_COMMIT_SHA (a Railway variable, set by the deploy step right before
// `railway up`) takes priority over BUILD_VERSION — confirmed necessary:
// Railway's Nixpacks build phase does NOT expose service variables to the
// `npm run build` step (only to the running container afterward), so a
// value baked in at build time via scripts/write-version.mjs always came
// back "unknown" in production even with the variable correctly set. Reading
// it here, at runtime, is what actually works; BUILD_VERSION (a real git
// SHA via a local `git rev-parse`) remains a useful fallback for local dev,
// where no such variable is typically set.
const RUNTIME_VERSION = process.env.GIT_COMMIT_SHA || BUILD_VERSION;

if (noProviderConfigured()) {
  console.warn(
    "[jennysol] No AI provider is configured (checked LLM_PROVIDER_CHAIN / LLM_PROVIDER and each provider's own credentials) — chat requests will fail. See server/.env.example."
  );
}

// Kicked off once at boot, before the server accepts any traffic, so the
// ~15s grounding-availability probe (see warmUpGemini's own comment) never
// runs concurrently with a real user's first request.
warmUpGemini();

// Sweeps sessions already past expires_at — safe by construction (see
// deleteExpiredSessions' own comment), never touches anything still
// reachable. Every hour is frequent enough that an abandoned guest session
// (24h sliding TTL — see sessions.ts) doesn't linger in the table for long,
// without being aggressive enough to matter for a process that could
// restart at any time anyway (nothing here is time-critical).
const SESSION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
setInterval(() => {
  try {
    const removed = deleteExpiredSessions();
    if (removed > 0) console.log(`[jennysol] cleaned up ${removed} expired session(s)`);
  } catch (err) {
    console.error("[jennysol] session cleanup failed (non-fatal):", err);
  }
}, SESSION_CLEANUP_INTERVAL_MS);

// A single unhandled error anywhere (a promise nobody awaited, a callback
// throwing outside a route handler) would otherwise kill the whole process
// by default — every user's session goes down for one bad request. Log it
// and keep serving instead. This is a deliberate tradeoff: Node's own docs
// recommend restarting after an uncaught exception because in-memory state
// could be inconsistent, but this app keeps no meaningful state outside
// SQLite (already durable) and per-request closures, so continuing is safer
// for uptime than it would be for, say, a stateful worker process.
process.on("uncaughtException", (err) => {
  console.error("[jennysol] uncaught exception:", err);
  logError("uncaughtException", err.message, { stack: err.stack });
});
process.on("unhandledRejection", (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  console.error("[jennysol] unhandled rejection:", err);
  logError("unhandledRejection", err.message, { stack: err.stack });
});

// Same-origin deploys (or local dev via the Vite proxy) don't need CORS at
// all; set CORS_ORIGIN when the client is hosted separately (e.g. Vercel)
// so this API isn't left open to every origin.
const app = express();

// Railway (and Vercel) put this app behind a reverse proxy, which sets
// X-Forwarded-For. Without telling Express to trust it, req.ip resolves to
// the proxy's own address for every request — express-rate-limit then can't
// tell users apart and buckets everyone into one shared limit, so one
// person's traffic can lock out someone else's login attempts.
app.set("trust proxy", 1);

// CORS_ORIGIN accepts a comma-separated list so both the current custom
// domain and any previous hosting URL (e.g. the old *.vercel.app one)
// keep working for anyone who still has it bookmarked or cached.
const allowedOrigins = process.env.CORS_ORIGIN?.split(",").map((o) => o.trim()).filter(Boolean);
app.use(cors(allowedOrigins ? { origin: allowedOrigins } : {}));
app.use(express.json());

// Light global limit (abuse/cost protection on every route). A much
// stricter one applies to the specific abuse-prone auth endpoints
// (signup/login/password-reset) inside auth.ts itself — NOT the whole
// /api/auth router, since that would also throttle routine authenticated
// calls like /me on every page load. The P0 gap this closes is flagged in
// JENNY_IMPLEMENTATION_STATUS.md.
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));

// `version` is the short git SHA this exact running process was built from
// (see scripts/write-version.mjs) — safe to expose publicly (it's not a
// secret, it's the same information `git log` gives anyone with repo
// access), and it's what makes "is Device A talking to the same backend
// build as Device B?" a value to read instead of a guess.
app.get("/health", (_req, res) => res.json({ status: "ok", version: RUNTIME_VERSION }));

// Every /api response carries user-scoped data (conversations, messages,
// documents, admin views) or an auth token — none of it is ever safe for a
// shared/intermediary cache (a browser's back-forward cache, a corporate
// proxy, a CDN) to store and later hand to a different session. Express
// sets no Cache-Control by default, which leaves that to each cache's own
// heuristics rather than an explicit rule; this makes it explicit instead.
// Set before the route mounts so any route's own more specific header
// (chat.ts's SSE stream already sets its own) simply overrides this
// default rather than conflicting with it.
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});

app.use("/api/auth", authRouter);
app.use("/api/chat", requireAuth, chatRouter);
app.use("/api/agent/runs", requireAuth, agentRunsRouter);
app.use("/api/conversations", requireAuth, conversationsRouter);
app.use("/api/documents", requireAuth, documentsRouter);
app.use("/api/image", requireAuth, imageRouter);
app.use("/api/speech", requireAuth, speechRouter);
app.use("/api/errors", errorsRouter);
app.use("/api/admin", adminRouter);

// In production, serve the built client so a single service hosts both the
// API and the UI — no separate static host needed for deployment.
const clientDist = path.resolve(import.meta.dirname, "../../client/dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

// Catch-all for anything a route handler passed to next(err) or threw
// synchronously and nothing local caught — Express's own default handler
// would otherwise leak stack traces as an HTML page. Must be registered
// last and keep all four params so Express recognizes it as an error handler.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[jennysol] request error:", err);
  logError("server", err.message, { stack: err.stack, path: req.path, userId: req.userId });
  if (!res.headersSent) {
    res.status(500).json({ error: "Something went wrong on the server. Please try again." });
  }
});

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => {
  console.log(`[jennysol] server listening on http://localhost:${port}`);
});
