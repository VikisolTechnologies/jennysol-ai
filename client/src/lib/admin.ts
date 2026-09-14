import { authFetch } from "./auth";

export interface AdminStats {
  totalUsers: number;
  usersByRole: { role: string; count: number }[];
  usersByProvider: { provider: string; count: number }[];
  newSignups7d: number;
  newSignups30d: number;
  activeUsers24h: number;
  activeUsers7d: number;
  totalConversations: number;
  totalMessages: number;
  signupsByDay: { day: string; count: number }[];
  messagesByDay: { day: string; count: number }[];
}

async function parseOrThrow(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export async function fetchAdminStats(): Promise<{ stats: AdminStats; errorsLast24h: number }> {
  const res = await authFetch("/api/admin/stats");
  return parseOrThrow(res);
}

export interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  authProvider: string;
  emailVerified: boolean;
  createdAt: string;
  lastActiveAt: string | null;
  conversationCount: number;
  messageCount: number;
}

export async function fetchAdminUsers(
  query: string,
  page: number
): Promise<{ users: AdminUserRow[]; total: number; page: number; limit: number }> {
  const params = new URLSearchParams({ page: String(page) });
  if (query) params.set("q", query);
  const res = await authFetch(`/api/admin/users?${params.toString()}`);
  return parseOrThrow(res);
}

export interface AdminConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

export async function fetchAdminUser(
  id: string
): Promise<{ user: AdminUserRow; conversations: AdminConversationSummary[] }> {
  const res = await authFetch(`/api/admin/users/${id}`);
  return parseOrThrow(res);
}

export async function fetchAdminConversation(
  userId: string,
  conversationId: string
): Promise<{ messages: { role: "user" | "assistant"; content: string; createdAt: string }[] }> {
  const res = await authFetch(`/api/admin/users/${userId}/conversations/${conversationId}`);
  return parseOrThrow(res);
}

export interface AdminErrorEntry {
  id: string;
  level: string;
  message: string;
  stack: string | null;
  path: string | null;
  userId: string | null;
  createdAt: string;
}

export async function fetchAdminErrors(
  page: number
): Promise<{ errors: AdminErrorEntry[]; page: number; limit: number }> {
  const res = await authFetch(`/api/admin/errors?page=${page}`);
  return parseOrThrow(res);
}

// Multi-agent engineering dashboard (docs/AI_AGENT_SYSTEM_ARCHITECTURE.md §8) — see
// server/src/routes/admin.ts's own comment on why this is admin-only. Shapes mirror
// agentSessionStore.ts/agentRegistry.ts/sessionEventBus.ts's server-side types exactly; duplicated
// here (not imported) since client and server don't share a types package in this codebase.
export type AgentSessionStatus = "planning" | "running" | "paused" | "completed" | "cancelled" | "failed";

export interface AgentSessionSummary {
  id: string;
  userId: string;
  objective: string;
  status: AgentSessionStatus;
  maxSessionTimeMs: number | null;
  maxTokenBudget: number | null;
  maxCost: number | null;
  maxAgentCount: number | null;
  maxConcurrentAgents: number | null;
  createdAt: string;
  completedAt: string | null;
}

export type AgentTaskStatus =
  | "pending"
  | "ready"
  | "queued"
  | "running"
  | "blocked"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export interface AgentTaskRow {
  id: string;
  sessionId: string;
  agentId: string | null;
  title: string;
  description: string | null;
  dependsOn: string[];
  status: AgentTaskStatus;
  priority: number;
  startedAt: string | null;
  completedAt: string | null;
  result: unknown;
  createdAt: string;
}

export type AgentRowStatus =
  | "idle"
  | "planning"
  | "working"
  | "waiting"
  | "blocked"
  | "reviewing"
  | "auditing"
  | "failed"
  | "completed"
  | "cancelled";

export interface AgentRow {
  id: string;
  sessionId: string;
  role: string;
  displayName: string;
  modelProvider: string | null;
  modelId: string | null;
  status: AgentRowStatus;
  capabilities: string[];
  permissions: string[];
  currentTaskId: string | null;
  tokensUsed: number;
  createdAt: string;
  updatedAt: string;
}

export interface SessionMemoryEntryRow {
  sessionId: string;
  key: string;
  value: unknown;
  updatedAt: string;
  updatedByAgentId: string | null;
}

export interface SessionEventRow {
  id: number;
  sessionId: string;
  agentId: string | null;
  taskId: string | null;
  type: string;
  payload: unknown;
  createdAt: string;
}

export async function fetchAgentSessions(): Promise<AgentSessionSummary[]> {
  const res = await authFetch("/api/admin/agent-sessions");
  const data = await parseOrThrow(res);
  return data.sessions;
}

export async function fetchAgentSessionDetail(id: string): Promise<{
  session: AgentSessionSummary;
  agents: AgentRow[];
  tasks: AgentTaskRow[];
  memory: SessionMemoryEntryRow[];
}> {
  const res = await authFetch(`/api/admin/agent-sessions/${id}`);
  return parseOrThrow(res);
}

export async function fetchAgentSessionEvents(id: string, afterId = 0): Promise<SessionEventRow[]> {
  const res = await authFetch(`/api/admin/agent-sessions/${id}/events?after=${afterId}`);
  const data = await parseOrThrow(res);
  return data.events;
}

// Stage A of JENNYSOL-AGENTS-UI-FIRST.md: the real "start a session" route landed in
// agentSessionRunner.ts/admin.ts — this is its client. Returns as soon as the session row exists;
// decomposition and execution continue server-side (see the route's own comment).
export async function startAgentSession(objective: string): Promise<AgentSessionSummary> {
  const res = await authFetch("/api/admin/agent-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ objective }),
  });
  const data = await parseOrThrow(res);
  return data.session;
}

export async function pauseAgentSession(id: string): Promise<void> {
  await parseOrThrow(await authFetch(`/api/admin/agent-sessions/${id}/pause`, { method: "POST" }));
}
export async function resumeAgentSession(id: string): Promise<void> {
  await parseOrThrow(await authFetch(`/api/admin/agent-sessions/${id}/resume`, { method: "POST" }));
}
export async function cancelAgentSession(id: string): Promise<void> {
  await parseOrThrow(await authFetch(`/api/admin/agent-sessions/${id}/cancel`, { method: "POST" }));
}
export async function killAgent(sessionId: string, agentId: string): Promise<void> {
  await parseOrThrow(await authFetch(`/api/admin/agent-sessions/${sessionId}/agents/${agentId}/kill`, { method: "POST" }));
}
export async function retryTask(sessionId: string, taskId: string): Promise<void> {
  await parseOrThrow(await authFetch(`/api/admin/agent-sessions/${sessionId}/tasks/${taskId}/retry`, { method: "POST" }));
}

// Stage B — the approval queue. A pending action's `args` are already redacted server-side
// (agentToolRegistry.ts's proposeAgentAction — redactSecrets before the event/action is ever
// stored), so this is safe to render as-is, not a raw internal payload.
export interface PendingAgentActionRow {
  id: string;
  sessionId: string;
  agentId: string;
  toolName: "file.write" | "exec.command";
  args: Record<string, unknown>;
  createdAt: number;
}

export async function fetchPendingActions(sessionId?: string): Promise<PendingAgentActionRow[]> {
  const qs = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
  const res = await authFetch(`/api/admin/agent-actions/pending${qs}`);
  const data = await parseOrThrow(res);
  return data.actions;
}

export async function approveAgentAction(actionId: string): Promise<void> {
  await parseOrThrow(await authFetch(`/api/admin/agent-actions/${actionId}/approve`, { method: "POST" }));
}
export async function rejectAgentAction(actionId: string): Promise<void> {
  await parseOrThrow(await authFetch(`/api/admin/agent-actions/${actionId}/reject`, { method: "POST" }));
}

// Stage A §2.1 — live event stream, client side. Not the native EventSource API: this app's auth is
// a Bearer token on a custom header (see authFetch), which EventSource cannot attach, so this
// mirrors api.ts's own sendChatMessage fetch+reader SSE parsing exactly rather than introducing a
// second streaming mechanism. Resolves when the stream ends (server closes it) or `signal` aborts —
// the caller owns reconnect policy, matching how ChatWindow owns recovery for the chat stream.
export async function streamAgentSessionEvents(
  sessionId: string,
  afterId: number,
  onEvent: (event: SessionEventRow) => void,
  signal: AbortSignal
): Promise<void> {
  const res = await authFetch(`/api/admin/agent-sessions/${sessionId}/stream?after=${afterId}`, { signal });
  if (!res.ok) throw new Error(`Stream failed (${res.status})`);
  if (!res.body) throw new Error("No response body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    let done: boolean, value: Uint8Array | undefined;
    try {
      ({ done, value } = await reader.read());
    } catch (err) {
      if (signal.aborted) return;
      throw err;
    }
    if (done) return;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue; // skips the ": heartbeat" comment lines
      try {
        onEvent(JSON.parse(line.slice(6)));
      } catch {
        // a partial/trailing chunk split across two reads — ignore, matches sendChatMessage's own
        // tolerance for the same class of boundary artifact
      }
    }
  }
}
