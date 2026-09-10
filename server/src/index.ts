import "dotenv/config";
import { app } from "./app.js";
import { noProviderConfigured } from "./services/llm.js";
import { warmUpGemini } from "./services/providers/gemini.js";
import { logError } from "./services/errorLog.js";
import { deleteExpiredSessions } from "./services/auth/sessions.js";
import "./db/index.js";

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

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => {
  console.log(`[jennysol] server listening on http://localhost:${port}`);
});
