// Phase 7 of docs/AI_AGENT_IMPLEMENTATION_PLAN.md: internal agent tool access. Deliberately new,
// small, and parallel to toolRegistry.ts/pendingActions.ts, NOT built on top of them — those are
// hard-wired to ProductIdentity for external (Arena-style) callers; reusing them for an internal
// agent would mean faking a product identity, exactly the cross-boundary shortcut this codebase
// already guards against (see docs/AI_AGENT_SYSTEM_ARCHITECTURE.md §2's correction). This module
// implements the same READ-executes-immediately / WRITE-needs-propose-approve-execute *shape*
// (ADR-004) because that shape is sound, keyed by (sessionId, agentId) + agents.permissions
// (Phase 2) instead of a product identity.
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getAgent, hasPermission } from "./agentRegistry.js";
import { appendSessionEvent } from "./sessionEventBus.js";
import { requestLock, releaseLock } from "./agentFileLocks.js";
import { redactSecrets } from "./memoryScope.js";

export class AgentToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentToolError";
  }
}

// Every file tool is confined to this root — resolved once, at module load, from this file's own
// location (server/src/services/ -> repo root, 3 levels up), the same import.meta.dirname-relative
// pattern db/index.ts already uses for its data directory. An autonomous agent's write tool escaping
// the repo entirely (via "../../../etc/passwd"-style traversal, or a stray absolute path) is exactly
// the kind of real security surface the founding directive's §36/§37 call out — bounded here
// structurally, not by convention. Overridable via AGENT_WORKSPACE_ROOT for tests only.
const WORKSPACE_ROOT = path.resolve(process.env.AGENT_WORKSPACE_ROOT || path.resolve(import.meta.dirname, "../../.."));

function resolveInWorkspace(filePath: string): string {
  const resolved = path.resolve(WORKSPACE_ROOT, filePath);
  if (resolved !== WORKSPACE_ROOT && !resolved.startsWith(WORKSPACE_ROOT + path.sep)) {
    throw new AgentToolError(`Path "${filePath}" escapes the agent workspace root — refused`);
  }
  return resolved;
}

function requirePermission(sessionId: string, agentId: string, permission: Parameters<typeof hasPermission>[1]) {
  const agent = getAgent(sessionId, agentId);
  if (!agent) throw new AgentToolError(`Agent ${agentId} not found in session ${sessionId}`);
  if (!hasPermission(agent, permission)) {
    throw new AgentToolError(`Agent ${agentId} (role ${agent.role}) lacks "${permission}" permission`);
  }
  return agent;
}

// READ tier — executes immediately (ADR-004), same as every READ tool elsewhere in this codebase.
export async function readFile(sessionId: string, agentId: string, filePath: string): Promise<string> {
  requirePermission(sessionId, agentId, "file:read");
  const resolved = resolveInWorkspace(filePath);
  appendSessionEvent({ sessionId, agentId, type: "tool.exec.started", payload: { tool: "file.read", filePath } });
  try {
    const content = await fs.readFile(resolved, "utf8");
    appendSessionEvent({
      sessionId,
      agentId,
      type: "tool.exec.finished",
      payload: { tool: "file.read", filePath, ok: true, bytes: content.length },
    });
    return content;
  } catch (err) {
    const error = redactSecrets(err instanceof Error ? err.message : String(err)) as string;
    appendSessionEvent({
      sessionId,
      agentId,
      type: "tool.exec.finished",
      payload: { tool: "file.read", filePath, ok: false, error },
    });
    throw err;
  }
}

// The actual write — module-private on purpose. The only public way to reach this is
// approveAgentAction(), never a direct call, so a WRITE can never bypass propose/approve (ADR-004).
async function executeFileWrite(sessionId: string, agentId: string, filePath: string, content: string): Promise<void> {
  const resolved = resolveInWorkspace(filePath);
  const { outcome, granted } = requestLock(sessionId, filePath, agentId);
  if (outcome === "wait") await granted;

  appendSessionEvent({ sessionId, agentId, type: "tool.exec.started", payload: { tool: "file.write", filePath } });
  try {
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, content, "utf8");
    appendSessionEvent({
      sessionId,
      agentId,
      type: "tool.exec.finished",
      payload: { tool: "file.write", filePath, ok: true, bytes: content.length },
    });
  } catch (err) {
    const error = redactSecrets(err instanceof Error ? err.message : String(err)) as string;
    appendSessionEvent({
      sessionId,
      agentId,
      type: "tool.exec.finished",
      payload: { tool: "file.write", filePath, ok: false, error },
    });
    throw err;
  } finally {
    releaseLock(sessionId, filePath, agentId);
  }
}

export type AgentToolName = "file.write";

export interface PendingAgentAction {
  id: string;
  sessionId: string;
  agentId: string;
  toolName: AgentToolName;
  args: Record<string, unknown>;
  createdAt: number;
}

// Mirrors pendingActions.ts's own TTL rationale exactly — a proposal outlives neither its usefulness
// nor a genuine approval delay by much; single-use by construction (deleted from the map before
// executing), same as that module.
const ACTION_TTL_MS = 5 * 60 * 1000;
const pendingActions = new Map<string, PendingAgentAction>();

export function proposeAgentAction(
  sessionId: string,
  agentId: string,
  toolName: AgentToolName,
  args: Record<string, unknown>
): PendingAgentAction {
  if (toolName === "file.write") requirePermission(sessionId, agentId, "file:write");
  const action: PendingAgentAction = { id: randomUUID(), sessionId, agentId, toolName, args, createdAt: Date.now() };
  pendingActions.set(action.id, action);
  appendSessionEvent({
    sessionId,
    agentId,
    type: "tool.exec.started",
    payload: { tool: toolName, status: "pending_approval", actionId: action.id, args: redactSecrets(args) },
  });
  return action;
}

export async function approveAgentAction(actionId: string): Promise<void> {
  const action = pendingActions.get(actionId);
  if (!action) throw new AgentToolError("No such pending action (already used, rejected, or expired)");
  pendingActions.delete(actionId);
  if (Date.now() - action.createdAt > ACTION_TTL_MS) {
    throw new AgentToolError("This action has expired");
  }

  if (action.toolName === "file.write") {
    await executeFileWrite(
      action.sessionId,
      action.agentId,
      action.args.filePath as string,
      action.args.content as string
    );
    return;
  }
  throw new AgentToolError(`Unknown tool "${action.toolName}"`);
}

export function rejectAgentAction(actionId: string): void {
  const action = pendingActions.get(actionId);
  if (!action) throw new AgentToolError("No such pending action (already used, rejected, or expired)");
  pendingActions.delete(actionId);
  appendSessionEvent({
    sessionId: action.sessionId,
    agentId: action.agentId,
    type: "tool.exec.finished",
    payload: { tool: action.toolName, actionId, ok: false, rejected: true },
  });
}

export function __clearPendingAgentActionsForTests(): void {
  pendingActions.clear();
}
