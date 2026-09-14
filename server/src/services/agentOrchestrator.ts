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
import { proposeAgentAction, awaitApprovalDecision, readFile } from "./agentToolRegistry.js";
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
  SECURITY_SYSTEM_PROMPT,
  PERFORMANCE_SYSTEM_PROMPT,
  CODE_REVIEWER_SYSTEM_PROMPT,
  UX_SYSTEM_PROMPT,
  PRODUCT_ANALYST_SYSTEM_PROMPT,
  FINAL_JUDGE_SYSTEM_PROMPT,
  VISUAL_QA_SYSTEM_PROMPT,
} from "./agentRolePrompts.js";
import { captureFileScreenshot } from "./agentScreenshotTool.js";
import { describeImage } from "./providers/ollamaVision.js";

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
// "visual_qa" is a special case just like "qa" — real defect detection over a real screenshot
// (agentScreenshotTool.ts + providers/ollamaVision.ts) needs the vision path, not runAgentTask's
// text-only routeChatCompletion() call, so it can never live in ROLE_EXECUTION's text-only shapes.
function assignableRoles(): AgentRole[] {
  return [...(Object.keys(ROLE_EXECUTION) as AgentRole[]), "qa", "visual_qa"];
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

// JENNYSOL-VISION-AND-IMAGERY.md Part A.4: Visual QA's own real-evidence path — a real screenshot
// (agentScreenshotTool.ts) of a real file, inspected by the real vision model
// (providers/ollamaVision.ts), never an LLM's own unverified claim about UI it was never shown. The
// task's own `description` carries the workspace-relative file path to screenshot, produced by the
// Orchestrator as part of its decomposition — mirroring QA's own description-carries-the-real-target
// convention above.
async function runVisualQaTask(sessionId: string, taskId: string, task: AgentTask, agent: Agent): Promise<void> {
  sessionStore.updateTaskStatus(sessionId, taskId, "running", { agentId: agent.id });
  updateAgentStatus(sessionId, agent.id, "working", { currentTaskId: taskId });
  appendSessionEvent({ sessionId, agentId: agent.id, taskId, type: "task.started", payload: { title: task.title } });

  const filePath = task.description?.trim();
  if (!filePath) {
    fail(sessionId, taskId, agent.id, `Visual QA task "${task.title}" has no file path in its description`);
  }

  let base64Png: string;
  try {
    const screenshot = await captureFileScreenshot(filePath);
    base64Png = screenshot.base64Png;
  } catch (err) {
    fail(sessionId, taskId, agent.id, err instanceof Error ? err.message : String(err));
  }

  let verdict: string;
  let findings: string[];
  try {
    const result = await describeImage(VISUAL_QA_SYSTEM_PROMPT, [base64Png]);
    const parsed = extractJson(result.content) as Record<string, unknown>;
    if (parsed.verdict !== "pass" && parsed.verdict !== "concerns") {
      throw new Error(`Visual QA output for task "${task.title}" has an invalid or missing verdict`);
    }
    verdict = parsed.verdict;
    findings = Array.isArray(parsed.findings) ? parsed.findings.filter((f): f is string => typeof f === "string") : [];
  } catch (err) {
    fail(sessionId, taskId, agent.id, err instanceof Error ? err.message : String(err));
  }

  const merged = mergeIntoSharedMemory(sessionId, "audit_results", agent.role, { verdict, findings });
  writeSessionMemory(sessionId, agent.id, "audit_results", merged);

  // The real screenshot lives in this task's own result — a deliberate storage decision
  // (agentScreenshotTool.ts's own header comment), not a new asset-storage system.
  sessionStore.updateTaskStatus(sessionId, taskId, "completed", { result: { verdict, findings, screenshotBase64: base64Png } });
  updateAgentStatus(sessionId, agent.id, "completed", { currentTaskId: null });
  appendSessionEvent({ sessionId, agentId: agent.id, taskId, type: "task.completed", payload: { verdict, findingsCount: findings.length } });
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
// Stage D group 2: reads real file content (never invents what a file contains — see
// readChangedFilesContent below) and writes a structured {verdict, findings} finding to
// "audit_results", keyed by its own role so three reviewers sharing that one memory key never
// clobber each other's findings (see the merge logic in runReviewCompletion).
type ReviewRoleConfig = { kind: "review"; systemPrompt: string };
// Stage D group 3: Product Analyst writes a real, bounded list — not a single prose note — since
// "open_questions" is a list of distinct questions, not one narrative (agentSessionStore.ts's own
// memory shape).
type ListMemoryRoleConfig = { kind: "list-memory"; systemPrompt: string; memoryKey: string };
// Final Judge: a distinct kind from "review" on purpose, even though the code shape (parse, merge
// into a shared memory key by role) is nearly identical — a review's "concerns" is not the same claim
// as a judge's "rejected" (the whole objective failed), so keeping them semantically separate avoids
// quietly blurring what a "verdict" means depending on which role produced it.
type JudgmentRoleConfig = { kind: "judgment"; systemPrompt: string };
type RoleExecutionConfig = ProseMemoryRoleConfig | FileWriteRoleConfig | ReviewRoleConfig | ListMemoryRoleConfig | JudgmentRoleConfig;

const ROLE_EXECUTION: Partial<Record<AgentRole, RoleExecutionConfig>> = {
  architect: { kind: "prose-memory", systemPrompt: ARCHITECT_SYSTEM_PROMPT, memoryKey: "architecture" },
  coder: { kind: "file-write", systemPrompt: CODER_SYSTEM_PROMPT },
  backend: { kind: "file-write", systemPrompt: BACKEND_SYSTEM_PROMPT },
  database: { kind: "file-write", systemPrompt: DATABASE_SYSTEM_PROMPT },
  ui: { kind: "file-write", systemPrompt: UI_SYSTEM_PROMPT },
  security: { kind: "review", systemPrompt: SECURITY_SYSTEM_PROMPT },
  performance: { kind: "review", systemPrompt: PERFORMANCE_SYSTEM_PROMPT },
  code_reviewer: { kind: "review", systemPrompt: CODE_REVIEWER_SYSTEM_PROMPT },
  ux: { kind: "prose-memory", systemPrompt: UX_SYSTEM_PROMPT, memoryKey: "current_plan" },
  product_analyst: { kind: "list-memory", systemPrompt: PRODUCT_ANALYST_SYSTEM_PROMPT, memoryKey: "open_questions" },
  final_judge: { kind: "judgment", systemPrompt: FINAL_JUDGE_SYSTEM_PROMPT },
};

// Shared by review and judgment completions: several roles can share one memory key over a session's
// lifetime (three reviewers writing "audit_results"; a re-run judge overwriting its own prior verdict
// is fine, but must never erase a *different* role's entry in the same object) — merge under this
// role's own key rather than overwrite the whole value.
function mergeIntoSharedMemory(sessionId: string, memoryKey: string, role: AgentRole, value: unknown): Record<string, unknown> {
  const existing = sessionStore.getMemory(sessionId, memoryKey);
  const merged =
    existing?.value && typeof existing.value === "object" && !Array.isArray(existing.value)
      ? { ...(existing.value as Record<string, unknown>) }
      : {};
  merged[role] = value;
  return merged;
}

// The augmentContext hook agentTaskRunner.ts gained in group 1, put to real use here: a review-shaped
// role's read scope (agentTaskRunner.ts's MEMORY_READ_SCOPE) already includes "changed_files", but
// that memory key only ever holds a list of *paths* — without actually reading each file for real,
// any "finding" a reviewer reported would be invented, not observed. Uses the same READ-tier
// readFile every other read already goes through (agentToolRegistry.ts, ADR-004) — no new boundary.
async function readChangedFilesContent(sessionId: string, agent: Agent): Promise<Record<string, unknown>> {
  const changedFiles = sessionStore.getMemory(sessionId, "changed_files")?.value;
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) return { file_contents: {} };
  const contents: Record<string, string> = {};
  for (const filePath of changedFiles) {
    if (typeof filePath !== "string") continue;
    try {
      contents[filePath] = await readFile(sessionId, agent.id, filePath);
    } catch (err) {
      contents[filePath] = `<could not read: ${err instanceof Error ? err.message : String(err)}>`;
    }
  }
  return { file_contents: contents };
}

async function runReviewCompletion(sessionId: string, roleName: string, fullText: string, ctx: { agent: Agent; task: AgentTask }): Promise<void> {
  const parsed = extractJson(fullText) as Record<string, unknown>;
  if (parsed.verdict !== "pass" && parsed.verdict !== "concerns") {
    throw new OrchestratorError(`${roleName} output for task "${ctx.task.title}" has an invalid or missing verdict`);
  }
  const findings = Array.isArray(parsed.findings) ? parsed.findings.filter((f): f is string => typeof f === "string") : [];
  const merged = mergeIntoSharedMemory(sessionId, "audit_results", ctx.agent.role, { verdict: parsed.verdict, findings });
  writeSessionMemory(sessionId, ctx.agent.id, "audit_results", merged);
}

function runListMemoryCompletion(sessionId: string, memoryKey: string, roleName: string, fullText: string, ctx: { agent: Agent; task: AgentTask }): void {
  const parsed = extractJson(fullText);
  if (!Array.isArray(parsed) || !parsed.every((q) => typeof q === "string")) {
    throw new OrchestratorError(`${roleName} output for task "${ctx.task.title}" is not a JSON array of strings`);
  }
  writeSessionMemory(sessionId, ctx.agent.id, memoryKey, parsed);
}

function runJudgmentCompletion(sessionId: string, roleName: string, fullText: string, ctx: { agent: Agent; task: AgentTask }): void {
  const parsed = extractJson(fullText) as Record<string, unknown>;
  if (parsed.verdict !== "accepted" && parsed.verdict !== "rejected") {
    throw new OrchestratorError(`${roleName} output for task "${ctx.task.title}" has an invalid or missing verdict`);
  }
  const summary = typeof parsed.summary === "string" ? parsed.summary : "";
  const merged = mergeIntoSharedMemory(sessionId, "audit_results", ctx.agent.role, { verdict: parsed.verdict, summary });
  writeSessionMemory(sessionId, ctx.agent.id, "audit_results", merged);
}

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
  if (agent.role === "visual_qa") {
    return runVisualQaTask(sessionId, taskId, task, agent);
  }

  const config = ROLE_EXECUTION[agent.role];
  if (!config) {
    throw new OrchestratorError(`Role "${agent.role}" has no real execution logic implemented yet`);
  }

  return runAgentTask(sessionId, taskId, {
    systemPromptOverride: config.systemPrompt,
    augmentContext: config.kind === "review" ? readChangedFilesContent : undefined,
    onComplete: async (fullText, ctx) => {
      if (config.kind === "prose-memory") {
        writeSessionMemory(sessionId, ctx.agent.id, config.memoryKey, { note: fullText.trim() });
        return;
      }
      if (config.kind === "review") {
        await runReviewCompletion(sessionId, agent.role, fullText, ctx);
        return;
      }
      if (config.kind === "list-memory") {
        runListMemoryCompletion(sessionId, config.memoryKey, agent.role, fullText, ctx);
        return;
      }
      if (config.kind === "judgment") {
        runJudgmentCompletion(sessionId, agent.role, fullText, ctx);
        return;
      }
      await runFileWriteCompletion(sessionId, agent.role, fullText, ctx);
    },
  });
}
