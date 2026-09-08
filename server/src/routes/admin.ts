import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { getAdminStats, listUsers, countUsers, getAdminUser, listConversationsForUser, getConversationForAdmin, conversationBelongsToUser } from "../services/adminStore.js";
import { listRecentErrors, countRecentErrors } from "../services/errorLog.js";
import { getCapabilityRegistry } from "../services/capabilityRegistry.js";

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
