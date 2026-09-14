// Phase 9 of docs/AI_AGENT_IMPLEMENTATION_PLAN.md: the first 4 real roles working together.
// decomposeObjective() is the Orchestrator role made real — the founding directive's own §9 worked
// example (a user objective becoming a real, dependency-ordered agent_tasks graph), not a fixture.
// runRoleTask() is the role-aware dispatcher: Architect and Coder run through the existing
// runAgentTask() (Phase 5) with a role-specific prompt and a real post-processing step; QA never
// calls an LLM at all (architecture doc §9/§12: a verdict must cite real evidence, never a model's
// own unverified "this passes") — it runs a real command through the exact same propose/approve gate
// every WRITE-tier tool uses (Phase 7/8) and reports PASS/FAIL from the real exit code.
import type { ChatTurn } from "./llmProvider.js";
import { routeChatCompletion } from "./modelRouter.js";
import * as sessionStore from "./agentSessionStore.js";
import type { AgentTask } from "./agentSessionStore.js";
import { spawnAgent, getAgent, updateAgentStatus, type Agent, type AgentRole } from "./agentRegistry.js";
import { createTaskBatch, type TaskDraft } from "./agentTaskDag.js";
import { runAgentTask } from "./agentTaskRunner.js";
import { proposeAgentAction, awaitApprovalDecision } from "./agentToolRegistry.js";
import { appendSessionEvent } from "./sessionEventBus.js";
import { extractJson } from "./agentJsonExtract.js";
import { writeSessionMemory } from "./agentMemoryWriteScope.js";
import {
  ORCHESTRATOR_SYSTEM_PROMPT,
  ARCHITECT_SYSTEM_PROMPT,
  CODER_SYSTEM_PROMPT,
  BACKEND_SYSTEM_PROMPT,
  DATABASE_SYSTEM_PROMPT,
  UI_SYSTEM_PROMPT,
} from "./agentRolePrompts.js";

export class OrchestratorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrchestratorError";
  }
}

interface OrchestratorTaskSpec {
  localId: string;
  role: AgentRole;
  title: string;
  description?: string;
  dependsOn: string[];
}

// Single source of truth for "which roles can the Orchestrator actually assign work to" — every
// role in ROLE_EXECUTION (defined further down, alongside runRoleTask) plus "qa" (handled specially,
// no LLM call). Computed once, not hand-duplicated as a second string list here, so adding a role to
// ROLE_EXECUTION in a later Stage D group is the only edit needed for the Orchestrator to be allowed
// to actually assign it — a role can never be planned for before it has real execution logic behind
// it (architecture doc §3's "do not fake autonomy").
function assignableRoles(): AgentRole[] {
  return [...(Object.keys(ROLE_EXECUTION) as AgentRole[]), "qa"];
}

function validateSpecs(value: unknown): OrchestratorTaskSpec[] {
  if (!Array.isArray(value)) throw new OrchestratorError("Orchestrator output was not a JSON array");
  const allowed = assignableRoles();
  return value.map((v, i) => {
    if (typeof v !== "object" || v === null) throw new OrchestratorError(`Task ${i} in orchestrator output is not an object`);
    const obj = v as Record<string, unknown>;
    if (typeof obj.localId !== "string") throw new OrchestratorError(`Task ${i} is missing a string "localId"`);
    if (typeof obj.role !== "string" || !allowed.includes(obj.role as AgentRole)) {
      throw new OrchestratorError(`Task "${obj.localId}" has invalid role "${String(obj.role)}" — must be one of ${allowed.join("/")}`);
    }
    if (typeof obj.title !== "string") throw new OrchestratorError(`Task "${obj.localId}" is missing a string "title"`);
    return {
      localId: obj.localId,
      role: obj.role as AgentRole,
      title: obj.title,
      description: typeof obj.description === "string" ? obj.description : undefined,
      dependsOn: Array.isArray(obj.dependsOn) ? obj.dependsOn.filter((d): d is string => typeof d === "string") : [],
    };
  });
}

export interface DecomposeResult {
  orchestratorAgentId: string;
  tasks: AgentTask[];
}

// Real, live: a real routeChatCompletion() call, real JSON parsing (honest failure if unparseable —
// agentJsonExtract.ts — never a silently-empty task list), real agents spawned per role actually
// referenced, real createTaskBatch() insert (with real cycle/self-dependency rejection already
// proven in Phase 3).
export async function decomposeObjective(sessionId: string, objective: string): Promise<DecomposeResult> {
  const orchestrator = spawnAgent(sessionId, "orchestrator");
  writeSessionMemory(sessionId, orchestrator.id, "requirements", { objective });
  updateAgentStatus(sessionId, orchestrator.id, "planning");
  appendSessionEvent({
    sessionId,
    agentId: orchestrator.id,
    type: "task.started",
    payload: { title: "Decompose objective" },
  });

  const history: ChatTurn[] = [{ role: "user", content: objective }];
  let fullText = "";
  try {
    const result = await routeChatCompletion(
      ORCHESTRATOR_SYSTEM_PROMPT,
      history,
      (delta) => {
        fullText += delta;
      },
      undefined,
      "reasoning"
    );

    const specs = validateSpecs(extractJson(fullText));
    if (specs.length === 0) throw new OrchestratorError("Orchestrator produced zero tasks");

    const agentByRole = new Map<string, string>();
    for (const spec of specs) {
      if (!agentByRole.has(spec.role)) {
        agentByRole.set(spec.role, spawnAgent(sessionId, spec.role).id);
      }
    }

    const drafts: TaskDraft[] = specs.map((s) => ({
      localId: s.localId,
      title: s.title,
      description: s.description,
      dependsOn: s.dependsOn,
    }));
    const created = createTaskBatch(sessionId, drafts);
    for (let i = 0; i < created.length; i++) {
      sessionStore.updateTaskStatus(sessionId, created[i].id, "pending", { agentId: agentByRole.get(specs[i].role)! });
    }

    updateAgentStatus(sessionId, orchestrator.id, "completed", {
      addTokensUsed: (result.usage?.promptTokens ?? 0) + (result.usage?.completionTokens ?? 0),
      modelProvider: result.providerUsed,
      modelId: result.model,
    });
    appendSessionEvent({
      sessionId,
      agentId: orchestrator.id,
      type: "task.completed",
      payload: { title: "Decompose objective", tasksCreated: created.length, provider: result.providerUsed },
    });

    return { orchestratorAgentId: orchestrator.id, tasks: sessionStore.listTasksForSession(sessionId) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateAgentStatus(sessionId, orchestrator.id, "failed");
    appendSessionEvent({
      sessionId,
      agentId: orchestrator.id,
      type: "task.failed",
      payload: { title: "Decompose objective", error: message },
    });
    throw err;
  }
}

function fail(
  sessionId: string,
  taskId: string,
  agentId: string,
  message: string
): never {
  sessionStore.updateTaskStatus(sessionId, taskId, "failed", { result: { error: message } });
  updateAgentStatus(sessionId, agentId, "failed", { currentTaskId: null });
  appendSessionEvent({ sessionId, agentId, taskId, type: "task.failed", payload: { error: message } });
  throw new OrchestratorError(message);
}

// QA's own real-evidence execution path — no LLM call. The task's own `description` carries the
// exact {cwd, command, args} to run, produced by the Orchestrator as part of its decomposition.
async function runQaTask(sessionId: string, taskId: string, task: AgentTask, agent: Agent): Promise<void> {
  sessionStore.updateTaskStatus(sessionId, taskId, "running", { agentId: agent.id });
  updateAgentStatus(sessionId, agent.id, "working", { currentTaskId: taskId });
  appendSessionEvent({ sessionId, agentId: agent.id, taskId, type: "task.started", payload: { title: task.title } });

  let spec: { cwd: string; command: string; args: string[] };
  try {
    spec = JSON.parse(task.description ?? "") as typeof spec;
  } catch {
    fail(sessionId, taskId, agent.id, `QA task "${task.title}" has an unparseable command spec in its description`);
  }

  let result: { exitCode: number | null };
  try {
    const action = proposeAgentAction(sessionId, agent.id, "exec.command", spec);
    sessionStore.updateTaskStatus(sessionId, taskId, "awaiting_approval");
    appendSessionEvent({
      sessionId,
      agentId: agent.id,
      taskId,
      type: "task.awaiting_approval",
      payload: { actionId: action.id, tool: "exec.command", command: spec.command, args: spec.args },
    });
    // Stage B: a real human decision, not a self-approval — this promise only resolves when the
    // admin approval-queue route (or this action's own TTL) actually decides. See
    // agentToolRegistry.ts's awaitApprovalDecision.
    const decision = await awaitApprovalDecision(action.id);
    if (!decision.approved) {
      throw new Error(`QA command was rejected${decision.error ? `: ${decision.error}` : ""}`);
    }
    result = decision.result as { exitCode: number | null };
  } catch (err) {
    fail(sessionId, taskId, agent.id, err instanceof Error ? err.message : String(err));
  }

  const passed = result.exitCode === 0;
  sessionStore.updateTaskStatus(sessionId, taskId, passed ? "completed" : "failed", { result });
  updateAgentStatus(sessionId, agent.id, passed ? "completed" : "failed", { currentTaskId: null });
  appendSessionEvent({
    sessionId,
    agentId: agent.id,
    taskId,
    type: passed ? "task.completed" : "task.failed",
    payload: { exitCode: result.exitCode },
  });
  if (!passed) throw new OrchestratorError(`QA check failed for task "${task.title}" (exit code ${result.exitCode})`);
}

// Stage D of JENNYSOL-AGENTS-UI-FIRST.md: the role-config table replacing what were per-role
// if-statements in runRoleTask below. Only 2 real execution shapes exist so far beyond QA's own
// (architect's "write one prose note to a memory key" and coder's "propose one approved file
// write") — backend/database/ui are mechanically identical to coder, so they're additional entries
// in the same table, not new branches. A role with no entry here has a real permission/capability
// row (agentRegistry.ts's ROLE_CATALOG) but no real execution logic yet — runRoleTask refuses it
// honestly (below) rather than silently doing nothing, matching architecture doc §3's "do not fake
// autonomy": the Orchestrator must never be allowed to hand work to a role that can't actually do it.
type ProseMemoryRoleConfig = { kind: "prose-memory"; systemPrompt: string; memoryKey: string };
type FileWriteRoleConfig = { kind: "file-write"; systemPrompt: string };
type RoleExecutionConfig = ProseMemoryRoleConfig | FileWriteRoleConfig;

const ROLE_EXECUTION: Partial<Record<AgentRole, RoleExecutionConfig>> = {
  architect: { kind: "prose-memory", systemPrompt: ARCHITECT_SYSTEM_PROMPT, memoryKey: "architecture" },
  coder: { kind: "file-write", systemPrompt: CODER_SYSTEM_PROMPT },
  backend: { kind: "file-write", systemPrompt: BACKEND_SYSTEM_PROMPT },
  database: { kind: "file-write", systemPrompt: DATABASE_SYSTEM_PROMPT },
  ui: { kind: "file-write", systemPrompt: UI_SYSTEM_PROMPT },
};

async function runFileWriteCompletion(sessionId: string, roleName: string, fullText: string, ctx: { agent: Agent; task: AgentTask }): Promise<void> {
  const parsed = extractJson(fullText) as Record<string, unknown>;
  if (typeof parsed.filePath !== "string" || typeof parsed.content !== "string") {
    throw new OrchestratorError(`${roleName} output for task "${ctx.task.title}" is missing filePath/content`);
  }
  const action = proposeAgentAction(sessionId, ctx.agent.id, "file.write", {
    filePath: parsed.filePath,
    content: parsed.content,
  });
  sessionStore.updateTaskStatus(sessionId, ctx.task.id, "awaiting_approval");
  appendSessionEvent({
    sessionId,
    agentId: ctx.agent.id,
    taskId: ctx.task.id,
    type: "task.awaiting_approval",
    payload: { actionId: action.id, tool: "file.write", filePath: parsed.filePath },
  });
  // Stage B: real human decision — see the identical note in runQaTask above.
  const decision = await awaitApprovalDecision(action.id);
  if (!decision.approved) {
    throw new OrchestratorError(
      `File write for task "${ctx.task.title}" was rejected${decision.error ? `: ${decision.error}` : ""}`
    );
  }
  const existing = sessionStore.getMemory(sessionId, "changed_files");
  const files = Array.isArray(existing?.value) ? (existing!.value as string[]) : [];
  writeSessionMemory(sessionId, ctx.agent.id, "changed_files", [...files, parsed.filePath]);
}

// The one entry point Phase 6's Scheduler (or a direct test) calls per task — dispatches to the
// right execution shape for whichever role owns this task.
export async function runRoleTask(sessionId: string, taskId: string): Promise<void> {
  const task = sessionStore.getTask(sessionId, taskId);
  if (!task) throw new OrchestratorError(`Task ${taskId} not found in session ${sessionId}`);
  if (!task.agentId) throw new OrchestratorError(`Task ${taskId} has no agent assigned yet`);
  const agent = getAgent(sessionId, task.agentId);
  if (!agent) throw new OrchestratorError(`Agent ${task.agentId} not found in session ${sessionId}`);

  if (agent.role === "qa") {
    return runQaTask(sessionId, taskId, task, agent);
  }

  const config = ROLE_EXECUTION[agent.role];
  if (!config) {
    throw new OrchestratorError(`Role "${agent.role}" has no real execution logic implemented yet`);
  }

  return runAgentTask(sessionId, taskId, {
    systemPromptOverride: config.systemPrompt,
    onComplete: async (fullText, ctx) => {
      if (config.kind === "prose-memory") {
        writeSessionMemory(sessionId, ctx.agent.id, config.memoryKey, { note: fullText.trim() });
        return;
      }
      await runFileWriteCompletion(sessionId, agent.role, fullText, ctx);
    },
  });
}
