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
import { getSessionUnscoped, listAllSessions, listMemory, listTasksForSession } from "../services/agentSessionStore.js";
import { listAgentsForSession } from "../services/agentRegistry.js";
import { getSessionEventsAfter } from "../services/sessionEventBus.js";

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
// route a regular signed-in user can reach. Read-only for now — no phase before 9 (real agent
// roles) can actually produce a session worth creating, so there is deliberately no "start a
// session" route yet; an empty list here is honest, not a stub.
adminRouter.get("/agent-sessions", (_req, res) => {
  res.json({ sessions: listAllSessions() });
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
