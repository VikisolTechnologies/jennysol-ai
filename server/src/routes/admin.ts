import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { getAdminStats, listUsers, countUsers, getAdminUser, listConversationsForUser, getConversationForAdmin, conversationBelongsToUser } from "../services/adminStore.js";
import { listRecentErrors, countRecentErrors } from "../services/errorLog.js";
import { getCapabilityRegistry } from "../services/capabilityRegistry.js";
import { getProviderRouteStatus } from "../services/modelRouter.js";
import { getHealthSnapshot } from "../services/providerHealth.js";
import { getHardwareSnapshot } from "../services/models/hardwareProfile.js";
import { listInstalledOllamaModels } from "../services/providers/ollama.js";
import { getMetricsSummary } from "../services/requestMetrics.js";
import { getSessionUnscoped, listAllSessions, listMemory, listTasksForSession, createSession, updateSessionStatus } from "../services/agentSessionStore.js";
import { listAgentsForSession } from "../services/agentRegistry.js";
import { getSessionEventsAfter, subscribeToSession, type SessionEvent } from "../services/sessionEventBus.js";
import { appendSessionEvent } from "../services/sessionEventBus.js";
import { decomposeObjective } from "../services/agentOrchestrator.js";
import { driveSession } from "../services/agentSessionRunner.js";
import { pauseSession, resumeSession, cancelSession, killAgent, retryTask, SessionControlError } from "../services/agentSessionControl.js";
import { listPendingActions, approveAgentAction, rejectAgentAction, AgentToolError } from "../services/agentToolRegistry.js";

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);

adminRouter.get("/stats", (_req, res) => {
  res.json({ stats: getAdminStats(), errorsLast24h: countRecentErrors(24) });
});

// Admin-only (see requireAdmin above) — reports configured/missing and
// available/unavailable per capability, computed live from the same checks
// each capability's own code path already uses. Never returns a secret
// value, only booleans/labels — see capabilityRegistry.ts and its test
// asserting no key value ever appears in this output.
adminRouter.get("/config-health", (_req, res) => {
  res.json({ capabilities: getCapabilityRegistry() });
});

// Admin-only — per-provider circuit-breaker state (section 45's "provider
// debugging panel"): which providers are in the active LLM_PROVIDER_CHAIN,
// each one's live health/cooldown/failure-kind counters, the active
// hardware profile driving local-model admission control, and (best-effort,
// never blocking the response) which Ollama models are actually pulled on
// this machine right now. Every field here is already secret-free by
// construction — configured() only ever checks presence, getHealthSnapshot()
// only ever holds counts/timestamps — so nothing here needs its own
// redaction pass the way a raw env dump would.
adminRouter.get("/provider-health", async (_req, res) => {
  const providers = getProviderRouteStatus();
  const health = getHealthSnapshot();
  const hardware = getHardwareSnapshot();
  const ollamaModels = await listInstalledOllamaModels().catch(() => []);
  res.json({
    providers: providers.map((p) => ({ ...p, health: health[p.name] ?? null })),
    hardware,
    ollamaModels,
  });
});

// Admin-only — per-provider rolling request metrics (Phase 1 of
// JENNYSOL-LOCAL-CUTOVER.md: "you cannot decide what you cannot see").
// In-memory only, same as providerHealth.ts — this is for judgement calls
// about the local-cutover decision, not a persisted audit trail.
adminRouter.get("/request-metrics", (_req, res) => {
  res.json({
    last1h: getMetricsSummary(60 * 60 * 1000),
    last24h: getMetricsSummary(24 * 60 * 60 * 1000),
  });
});

const listQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

adminRouter.get("/users", (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const { q = "", page } = parsed.data;
  const limit = 25;
  const offset = (page - 1) * limit;
  res.json({ users: listUsers(q, limit, offset), total: countUsers(q), page, limit });
});

adminRouter.get("/users/:id", (req, res) => {
  const user = getAdminUser(req.params.id);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ user, conversations: listConversationsForUser(user.id) });
});

adminRouter.get("/users/:id/conversations/:conversationId", (req, res) => {
  const { id, conversationId } = req.params;
  if (!conversationBelongsToUser(id, conversationId)) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  res.json({ messages: getConversationForAdmin(conversationId) });
});

// Multi-agent engineering dashboard (docs/AI_AGENT_SYSTEM_ARCHITECTURE.md §8) — admin-only by
// design (see agentSessionStore.ts's getSessionUnscoped/listAllSessions doc comment): this is a
// founder-facing tool for watching AI-engineering sessions that build JennySol itself, not a
// consumer feature, so it lives under /api/admin (already requireAuth+requireAdmin above), not a
// route a regular signed-in user can reach.
adminRouter.get("/agent-sessions", (_req, res) => {
  res.json({ sessions: listAllSessions() });
});

const startSessionSchema = z.object({ objective: z.string().trim().min(1).max(4000) });

// Stage A of JENNYSOL-AGENTS-UI-FIRST.md — the real "start a session" route that didn't exist before
// this stage (Phase 9 proved the roles work; nothing before this route could actually kick a real
// objective off through the real API). Returns as soon as the session row exists (a plain SQLite
// write) — decomposition (a real LLM call) and execution both continue in the background, the same
// fire-and-forget shape chatRunner.ts already uses, so a slow or even-failed decomposition never
// makes this request hang.
adminRouter.post("/agent-sessions", (req, res) => {
  const parsed = startSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const session = createSession({ userId: req.userId!, objective: parsed.data.objective });
  res.status(201).json({ session });

  decomposeObjective(session.id, parsed.data.objective)
    .then(() => {
      updateSessionStatus(session.id, "running");
      appendSessionEvent({ sessionId: session.id, type: "session.status_changed", payload: { status: "running" } });
      driveSession(session.id).catch(() => {
        // driveSession's own loop already records every real failure as a real event before
        // returning — this catch exists only so an unexpected throw from the loop itself never
        // becomes an unhandled rejection.
      });
    })
    .catch(() => {
      // decomposeObjective already recorded the real task.failed event and failed the orchestrator
      // agent (agentOrchestrator.ts) — this only propagates that honest outcome to the session's own
      // status so the dashboard's session list doesn't show a permanently "planning" session.
      updateSessionStatus(session.id, "failed");
      appendSessionEvent({
        sessionId: session.id,
        type: "session.status_changed",
        payload: { status: "failed", reason: "decomposition_failed" },
      });
    });
});

// Stage B — pause/resume/cancel a whole session, or kill one agent within it. Every one of these is
// a real, durable state transition (agentSessionControl.ts) the Scheduler and driver loop already
// respect; none of this is a UI-only label.
adminRouter.post("/agent-sessions/:id/pause", (req, res) => {
  try {
    pauseSession(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(err instanceof SessionControlError ? 400 : 500).json({ error: err instanceof Error ? err.message : "Could not pause" });
  }
});

adminRouter.post("/agent-sessions/:id/resume", (req, res) => {
  try {
    resumeSession(req.params.id);
    driveSession(req.params.id).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    res.status(err instanceof SessionControlError ? 400 : 500).json({ error: err instanceof Error ? err.message : "Could not resume" });
  }
});

adminRouter.post("/agent-sessions/:id/cancel", (req, res) => {
  try {
    cancelSession(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(err instanceof SessionControlError ? 400 : 500).json({ error: err instanceof Error ? err.message : "Could not cancel" });
  }
});

adminRouter.post("/agent-sessions/:id/agents/:agentId/kill", (req, res) => {
  try {
    killAgent(req.params.id, req.params.agentId);
    res.json({ ok: true });
  } catch (err) {
    res.status(err instanceof SessionControlError ? 400 : 500).json({ error: err instanceof Error ? err.message : "Could not kill agent" });
  }
});

// Stage C §5.3 — resume from a checkpoint rather than restart: resets exactly the one failed task
// (agentSessionControl.ts's retryTask) and re-invokes the driver loop, same shape as resume's own
// route (driveSession is a no-op if a loop for this session is already alive).
adminRouter.post("/agent-sessions/:id/tasks/:taskId/retry", (req, res) => {
  try {
    retryTask(req.params.id, req.params.taskId);
    driveSession(req.params.id).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    res.status(err instanceof SessionControlError ? 400 : 500).json({ error: err instanceof Error ? err.message : "Could not retry task" });
  }
});

// Stage B — the approval queue. `sessionId` optional so this doubles as one global queue across
// every in-flight session (the founder-facing "everything waiting on me, right now" view) and a
// per-session filter on the run detail page.
adminRouter.get("/agent-actions/pending", (req, res) => {
  const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : undefined;
  res.json({ actions: listPendingActions(sessionId) });
});

adminRouter.post("/agent-actions/:id/approve", async (req, res) => {
  try {
    const result = await approveAgentAction(req.params.id);
    res.json({ ok: true, result });
  } catch (err) {
    res.status(err instanceof AgentToolError ? 400 : 500).json({ error: err instanceof Error ? err.message : "Could not approve" });
  }
});

adminRouter.post("/agent-actions/:id/reject", (req, res) => {
  try {
    rejectAgentAction(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(err instanceof AgentToolError ? 400 : 500).json({ error: err instanceof Error ? err.message : "Could not reject" });
  }
});

adminRouter.get("/agent-sessions/:id", (req, res) => {
  const session = getSessionUnscoped(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json({
    session,
    agents: listAgentsForSession(session.id),
    tasks: listTasksForSession(session.id),
    memory: listMemory(session.id),
  });
});

// Event replay — same ?after=<id> cursor pattern as GET /api/agent/runs/:id/events, one level up.
adminRouter.get("/agent-sessions/:id/events", (req, res) => {
  const session = getSessionUnscoped(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  const after = Number(req.query.after) || 0;
  res.json({ events: getSessionEventsAfter(session.id, after) });
});

// Stage A — live event stream. Same SSE shape as chat.ts's own route (headers, heartbeat,
// unsubscribe-on-close): transport and rendering only, no new domain logic — the events themselves
// already exist (sessionEventBus.ts, Phase 4). Replays anything after `?after=` before subscribing
// live, so a client that connects mid-run (or reconnects after a drop) never misses an event between
// its last known id and this connection's subscribe() call.
adminRouter.get("/agent-sessions/:id/stream", (req, res) => {
  const session = getSessionUnscoped(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let closed = false;
  function write(event: SessionEvent) {
    if (closed) return;
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      closed = true;
    }
  }

  const after = Number(req.query.after) || 0;
  for (const event of getSessionEventsAfter(session.id, after)) write(event);

  const unsubscribe = subscribeToSession(session.id, write);
  const heartbeat = setInterval(() => {
    if (!closed) res.write(": heartbeat\n\n");
  }, 15000);

  req.on("close", () => {
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
  });
});

const errorsQuerySchema = z.object({ page: z.coerce.number().int().min(1).default(1) });

adminRouter.get("/errors", (req, res) => {
  const parsed = errorsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const limit = 50;
  const offset = (parsed.data.page - 1) * limit;
  res.json({ errors: listRecentErrors(limit, offset), page: parsed.data.page, limit });
});
