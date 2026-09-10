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
import { agentGatewayRouter } from "./routes/agentGateway.js";
import { capabilitiesRouter } from "./routes/capabilities.js";
import { requireAuth } from "./middleware/auth.js";
import { logError } from "./services/errorLog.js";
import { BUILD_VERSION } from "./version.js";

// The configured Express app, split out from index.ts (2026-09-10) so it can
// be imported directly by supertest-based route tests without also
// triggering index.ts's boot-time side effects (warmUpGemini's real network
// probe, the hourly session-cleanup interval, process-level crash handlers)
// or binding a real port. index.ts still owns all of that — this file only
// owns request handling, unchanged from what it was inline there.

// GIT_COMMIT_SHA (a Railway variable, set by the deploy step right before
// `railway up`) takes priority over BUILD_VERSION — see index.ts's original
// comment history for why (Railway's Nixpacks build phase doesn't expose
// service variables to `npm run build`, only to the running container).
const RUNTIME_VERSION = process.env.GIT_COMMIT_SHA || BUILD_VERSION;

export const app = express();

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
// calls like /me on every page load.
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
// M6: requireProductIdentity is applied inside agentGatewayRouter itself, not at the mount
// level — same pattern already used by adminRouter (requireAuth + requireAdmin applied
// internally) — since this router's auth is a completely different mechanism (a service token,
// never a JennySol session) from every other route mounted here.
app.use("/api/agent/gateway", agentGatewayRouter);
app.use("/api/conversations", requireAuth, conversationsRouter);
app.use("/api/documents", requireAuth, documentsRouter);
app.use("/api/image", requireAuth, imageRouter);
app.use("/api/speech", requireAuth, speechRouter);
app.use("/api/errors", errorsRouter);
app.use("/api/capabilities", capabilitiesRouter);
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
