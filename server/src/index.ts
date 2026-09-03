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
import { requireAuth } from "./middleware/auth.js";
import { activeProviderMissingKey } from "./services/llm.js";
import { logError } from "./services/errorLog.js";
import "./db/index.js";

const missingKey = activeProviderMissingKey();
if (missingKey) {
  console.warn(`[jennysol] ${missingKey} is not set — chat requests will fail. See server/.env.example.`);
}

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
app.use(cors(process.env.CORS_ORIGIN ? { origin: process.env.CORS_ORIGIN } : {}));
app.use(express.json());

// Light global limit (abuse/cost protection on every route). A much
// stricter one applies to the specific abuse-prone auth endpoints
// (signup/login/password-reset) inside auth.ts itself — NOT the whole
// /api/auth router, since that would also throttle routine authenticated
// calls like /me on every page load. The P0 gap this closes is flagged in
// JENNY_IMPLEMENTATION_STATUS.md.
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use("/api/auth", authRouter);
app.use("/api/chat", requireAuth, chatRouter);
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
