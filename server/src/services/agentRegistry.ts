// Phase 2 of docs/AI_AGENT_IMPLEMENTATION_PLAN.md: CRUD over the `agents` table, plus the
// role -> capability -> default-permission catalog every later role definition (Phase 9/12) will
// extend, not replace. "Spawn" is deliberately pure logic — a row insert, nothing else — which is
// the concrete thing that makes the architecture doc's central claim ("many logical agents, few
// concurrent model executions," §6) testable from this phase on rather than asserted later.
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import type { TaskCapability } from "./models/modelRegistry.js";

// The 14 roles named across the founding directive and docs/AI_AGENT_SYSTEM_ARCHITECTURE.md §9/§12
// — Orchestrator/Architect/Coder/QA (Phase 9, built first) plus the ten QA-pipeline specialists
// (Phase 12, built later). Defining the full catalog now (not per-phase) is what makes "agent
// count" and "role definitions exist" two separate, independently-true claims: every role below can
// be spawned as a logical agent today; only 4 of them have a real system prompt/tool grant wired to
// actual work yet (Phase 9), and none has model calls flowing until Phase 5.
export type AgentRole =
  | "orchestrator"
  | "architect"
  | "coder"
  | "qa"
  | "security"
  | "performance"
  | "code_reviewer"
  | "product_analyst"
  | "ux"
  | "ui"
  | "backend"
  | "database"
  | "visual_qa"
  | "final_judge";

export type AgentStatus =
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

// Deliberately small and closed — a permission an agent doesn't hold in this list must be refused
// by Phase 7's agentToolRegistry.ts, not silently allowed because the field was merely present.
export type AgentPermission =
  | "memory:write_any" // write any session_memory key, not just the ones a role's normal scope covers (Orchestrator, Final Judge)
  | "file:read"
  | "file:write"
  | "exec:command"
  | "task:create"; // decompose the objective into new agent_tasks (Orchestrator)

interface RoleDefinition {
  role: AgentRole;
  displayName: string;
  // Feeds Phase 5's runAgentTask(): which existing modelRegistry.ts capability this role's calls
  // route under. Reuses the exact enum routeChatCompletion() already uses for chat — no new
  // routing concept, per architecture doc §2's "reused directly, no changes."
  defaultTaskCapability: TaskCapability;
  defaultPermissions: AgentPermission[];
}

// The role -> capability -> default-permission table (Phase 2's own documentation requirement).
// Real system prompts, memory read-scopes, and tool grants are Phase 9 (first 4) / Phase 12
// (remaining 10) — this table is intentionally only what Phase 2 needs: enough to spawn a
// correctly-shaped row and have *something* real to check permissions against (see hasPermission
// below), not a finished role definition.
export const ROLE_CATALOG: Record<AgentRole, RoleDefinition> = {
  orchestrator: {
    role: "orchestrator",
    displayName: "Orchestrator",
    defaultTaskCapability: "reasoning",
    defaultPermissions: ["memory:write_any", "task:create"],
  },
  architect: {
    role: "architect",
    displayName: "Architect",
    defaultTaskCapability: "reasoning",
    defaultPermissions: ["file:read", "memory:write_any"],
  },
  coder: {
    role: "coder",
    displayName: "Coder",
    defaultTaskCapability: "coding",
    defaultPermissions: ["file:read", "file:write", "exec:command"],
  },
  qa: {
    role: "qa",
    displayName: "QA",
    defaultTaskCapability: "reasoning",
    defaultPermissions: ["file:read", "exec:command"],
  },
  security: {
    role: "security",
    displayName: "Security",
    defaultTaskCapability: "reasoning",
    defaultPermissions: ["file:read", "exec:command"],
  },
  performance: {
    role: "performance",
    displayName: "Performance",
    defaultTaskCapability: "reasoning",
    defaultPermissions: ["file:read", "exec:command"],
  },
  code_reviewer: {
    role: "code_reviewer",
    displayName: "Code Reviewer",
    defaultTaskCapability: "coding",
    defaultPermissions: ["file:read"],
  },
  product_analyst: {
    role: "product_analyst",
    displayName: "Product Analyst",
    defaultTaskCapability: "general",
    defaultPermissions: ["file:read"],
  },
  ux: {
    role: "ux",
    displayName: "UX",
    defaultTaskCapability: "general",
    defaultPermissions: ["file:read"],
  },
  ui: {
    role: "ui",
    displayName: "UI",
    defaultTaskCapability: "coding",
    defaultPermissions: ["file:read", "file:write"],
  },
  backend: {
    role: "backend",
    displayName: "Backend",
    defaultTaskCapability: "coding",
    defaultPermissions: ["file:read", "file:write", "exec:command"],
  },
  database: {
    role: "database",
    displayName: "Database",
    defaultTaskCapability: "coding",
    defaultPermissions: ["file:read", "file:write", "exec:command"],
  },
  visual_qa: {
    role: "visual_qa",
    displayName: "Visual QA",
    // Needs a real screenshot mechanism, flagged as its own design pass in Phase 12 — not solved
    // by prompting alone. Capability/permissions recorded now so the row shape doesn't change later.
    defaultTaskCapability: "general",
    defaultPermissions: ["file:read", "exec:command"],
  },
  final_judge: {
    role: "final_judge",
    displayName: "Final Judge",
    defaultTaskCapability: "reasoning",
    defaultPermissions: ["memory:write_any"],
  },
};

export interface Agent {
  id: string;
  sessionId: string;
  role: AgentRole;
  displayName: string;
  modelProvider: string | null;
  modelId: string | null;
  status: AgentStatus;
  capabilities: TaskCapability[];
  permissions: AgentPermission[];
  currentTaskId: string | null;
  tokensUsed: number;
  createdAt: string;
  updatedAt: string;
}

interface AgentRow {
  id: string;
  session_id: string;
  role: AgentRole;
  display_name: string;
  model_provider: string | null;
  model_id: string | null;
  status: AgentStatus;
  capabilities: string | null;
  permissions: string | null;
  current_task_id: string | null;
  tokens_used: number;
  created_at: string;
  updated_at: string;
}

function rowToAgent(r: AgentRow): Agent {
  return {
    id: r.id,
    sessionId: r.session_id,
    role: r.role,
    displayName: r.display_name,
    modelProvider: r.model_provider,
    modelId: r.model_id,
    status: r.status,
    capabilities: r.capabilities ? JSON.parse(r.capabilities) : [],
    permissions: r.permissions ? JSON.parse(r.permissions) : [],
    currentTaskId: r.current_task_id,
    tokensUsed: r.tokens_used,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// Pure logic: one row insert, no model call, no process spawned, no import of any provider module.
// This is the literal mechanism behind "100 logical agents cost 100 rows" (architecture doc §6) —
// proven, not just asserted, by agentRegistry.test.ts's 50-agent timing regression test.
export function spawnAgent(
  sessionId: string,
  role: AgentRole,
  overrides?: { displayName?: string; permissions?: AgentPermission[] }
): Agent {
  const def = ROLE_CATALOG[role];
  const id = randomUUID();
  db.prepare(
    `INSERT INTO agents (id, session_id, role, display_name, status, capabilities, permissions, tokens_used)
     VALUES (?, ?, ?, ?, 'idle', ?, ?, 0)`
  ).run(
    id,
    sessionId,
    role,
    overrides?.displayName ?? def.displayName,
    JSON.stringify([def.defaultTaskCapability]),
    JSON.stringify(overrides?.permissions ?? def.defaultPermissions)
  );
  return getAgent(sessionId, id)!;
}

// Scoped by sessionId, matching agentSessionStore.getTask's cross-session-leakage discipline.
export function getAgent(sessionId: string, agentId: string): Agent | null {
  const row = db.prepare(`SELECT * FROM agents WHERE id = ? AND session_id = ?`).get(agentId, sessionId) as
    | AgentRow
    | undefined;
  return row ? rowToAgent(row) : null;
}

export function listAgentsForSession(sessionId: string): Agent[] {
  const rows = db
    .prepare(`SELECT * FROM agents WHERE session_id = ? ORDER BY created_at ASC, rowid ASC`)
    .all(sessionId) as AgentRow[];
  return rows.map(rowToAgent);
}

export function updateAgentStatus(
  sessionId: string,
  agentId: string,
  status: AgentStatus,
  extra?: { currentTaskId?: string | null; addTokensUsed?: number; modelProvider?: string; modelId?: string }
): void {
  db.prepare(
    `UPDATE agents SET
       status = ?,
       current_task_id = CASE WHEN ? THEN ? ELSE current_task_id END,
       tokens_used = tokens_used + ?,
       model_provider = COALESCE(?, model_provider),
       model_id = COALESCE(?, model_id),
       updated_at = datetime('now')
     WHERE id = ? AND session_id = ?`
  ).run(
    status,
    extra && "currentTaskId" in extra ? 1 : 0,
    extra?.currentTaskId ?? null,
    extra?.addTokensUsed ?? 0,
    extra?.modelProvider ?? null,
    extra?.modelId ?? null,
    agentId,
    sessionId
  );
}

// Not wired to any real dispatch path yet — Phase 7's agentToolRegistry.ts is the real enforcement
// point (architecture doc §2's corrected reuse note). This exists now so a permission on the schema
// is never merely decorative even before Phase 7 lands, per this phase's own audit requirement.
export function hasPermission(agent: Pick<Agent, "permissions">, permission: AgentPermission): boolean {
  return agent.permissions.includes(permission);
}
