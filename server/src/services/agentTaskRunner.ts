// Phase 5 of docs/AI_AGENT_IMPLEMENTATION_PLAN.md: the LLM provider touch-point. Nothing new in the
// provider layer itself (architecture doc §1/§2 — already solid, reused as-is) — this is exactly
// one integration function, runAgentTask(), that assembles a prompt from an agent's declared memory
// read-scope and calls the *existing* routeChatCompletion(), the same function every chat message in
// this app already goes through.
import type { ChatTurn } from "./llmProvider.js";
import { routeChatCompletion, AllProvidersUnavailableError } from "./modelRouter.js";
import * as sessionStore from "./agentSessionStore.js";
import { getAgent, updateAgentStatus, ROLE_CATALOG, type AgentRole, type Agent } from "./agentRegistry.js";
import { appendSessionEvent } from "./sessionEventBus.js";

export class AgentTaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentTaskError";
  }
}

// The exact prompt-assembly rule (this phase's own documentation requirement): which
// session_memory keys a given role reads to build its task prompt. This is what keeps context
// bounded per agent (architecture doc §5) instead of ever dumping the full session state into every
// prompt — an agent's role determines what it sees, not what happens to exist in memory. Write-scope
// enforcement is a separate, later concern (Phase 10) — this table only governs reads, for prompt
// assembly, today.
export const MEMORY_READ_SCOPE: Record<AgentRole, string[]> = {
  orchestrator: ["requirements", "constraints", "decisions", "current_plan", "open_questions"],
  architect: ["requirements", "constraints", "architecture", "decisions"],
  coder: ["architecture", "current_plan", "changed_files", "decisions"],
  qa: ["current_plan", "changed_files", "tests"],
  security: ["architecture", "changed_files", "audit_results"],
  performance: ["architecture", "changed_files", "audit_results"],
  code_reviewer: ["changed_files", "current_plan"],
  product_analyst: ["requirements", "current_plan", "open_questions"],
  ux: ["requirements", "current_plan"],
  ui: ["architecture", "current_plan", "changed_files"],
  backend: ["architecture", "current_plan", "changed_files"],
  database: ["architecture", "changed_files"],
  visual_qa: ["changed_files", "current_plan"],
  final_judge: ["requirements", "current_plan", "audit_results", "tests", "changed_files"],
};

function appendMemoryBlock(prompt: string, memoryContext: Record<string, unknown>): string {
  if (Object.keys(memoryContext).length === 0) return prompt;
  return `${prompt}\n\nRelevant session memory:\n${JSON.stringify(memoryContext, null, 2)}`;
}

function assembleSystemPrompt(role: AgentRole, memoryContext: Record<string, unknown>): string {
  const def = ROLE_CATALOG[role];
  return appendMemoryBlock(
    `You are the ${def.displayName} agent in a multi-agent engineering session. ` +
      `Complete the assigned task using only the context provided.`,
    memoryContext
  );
}

export interface RunAgentTaskOptions {
  // Phase 9: a role-specific prompt (agentRolePrompts.ts) replacing the generic one-liner below —
  // the memory-context block is still appended by this function either way, so a role's declared
  // read-scope stays the single source of what context assembly means, regardless of which prompt
  // text precedes it.
  systemPromptOverride?: string;
  // Stage D of JENNYSOL-AGENTS-UI-FIRST.md: runs BEFORE prompt assembly, its return value merged
  // into the same memoryContext block MEMORY_READ_SCOPE already populates. Real need, not
  // speculative: a review-shaped role (security/performance/code_reviewer) declares "changed_files"
  // in its read scope, but that memory key only ever holds a list of *paths* — without this hook, a
  // reviewer would see filenames and nothing else, and any "finding" it reported would be invented,
  // not a real read of the code (exactly the fabrication this whole engagement has refused
  // everywhere else). Lets a role read real file content (agentToolRegistry.ts's own READ-tier
  // readFile, which executes immediately, ADR-004) before the model ever runs.
  augmentContext?: (sessionId: string, agent: Agent) => Promise<Record<string, unknown>>;
  // Runs AFTER a successful model call but BEFORE the task/agent are marked "completed" — a
  // role-specific post-processing step (Phase 9: Architect writes to session_memory, Coder parses
  // the response and proposes a real file write). Throwing here fails the task with the real error,
  // exactly like a provider failure — post-processing is not a best-effort afterthought.
  onComplete?: (fullText: string, ctx: { agent: Agent; task: sessionStore.AgentTask }) => Promise<void>;
}

// Requires task.agentId already set (assigning a task to an agent is the Scheduler's job, Phase 6 —
// this phase is deliberately just the one-task/one-agent integration point, tested directly rather
// than through a scheduling loop that doesn't exist yet).
export async function runAgentTask(sessionId: string, taskId: string, options?: RunAgentTaskOptions): Promise<void> {
  const task = sessionStore.getTask(sessionId, taskId);
  if (!task) throw new AgentTaskError(`Task ${taskId} not found in session ${sessionId}`);
  if (!task.agentId) throw new AgentTaskError(`Task ${taskId} has no agent assigned yet`);
  const agent = getAgent(sessionId, task.agentId);
  if (!agent) throw new AgentTaskError(`Agent ${task.agentId} not found in session ${sessionId}`);

  const memoryContext: Record<string, unknown> = {};
  for (const key of MEMORY_READ_SCOPE[agent.role]) {
    const entry = sessionStore.getMemory(sessionId, key);
    if (entry) memoryContext[key] = entry.value;
  }
  if (options?.augmentContext) {
    Object.assign(memoryContext, await options.augmentContext(sessionId, agent));
  }

  const systemPrompt = options?.systemPromptOverride
    ? appendMemoryBlock(options.systemPromptOverride, memoryContext)
    : assembleSystemPrompt(agent.role, memoryContext);
  const history: ChatTurn[] = [
    { role: "user", content: task.description ? `${task.title}\n\n${task.description}` : task.title },
  ];

  sessionStore.updateTaskStatus(sessionId, taskId, "running", { agentId: agent.id });
  updateAgentStatus(sessionId, agent.id, "working", { currentTaskId: taskId });
  appendSessionEvent({ sessionId, agentId: agent.id, taskId, type: "task.started", payload: { title: task.title } });

  let fullText = "";
  try {
    const result = await routeChatCompletion(
      systemPrompt,
      history,
      (delta) => {
        fullText += delta;
      },
      undefined,
      agent.capabilities[0] ?? "general"
    );

    if (options?.onComplete) {
      await options.onComplete(fullText, { agent, task });
    }

    sessionStore.updateTaskStatus(sessionId, taskId, "completed", {
      result: { response: fullText, provider: result.providerUsed },
    });
    updateAgentStatus(sessionId, agent.id, "completed", {
      currentTaskId: null,
      addTokensUsed: (result.usage?.promptTokens ?? 0) + (result.usage?.completionTokens ?? 0),
      modelProvider: result.providerUsed,
      modelId: result.model,
    });
    appendSessionEvent({
      sessionId,
      agentId: agent.id,
      taskId,
      type: "task.completed",
      payload: { provider: result.providerUsed, totalMs: result.totalMs, wasWarm: result.wasWarm ?? null },
    });
  } catch (err) {
    // A real provider error (or every configured provider unavailable) must mark the task failed
    // with the real error attached — never silently retried or swallowed (this phase's own audit
    // requirement).
    const message =
      err instanceof AllProvidersUnavailableError
        ? `${err.message}: ${JSON.stringify(err.attempts)}`
        : err instanceof Error
          ? err.message
          : String(err);
    sessionStore.updateTaskStatus(sessionId, taskId, "failed", { result: { error: message } });
    updateAgentStatus(sessionId, agent.id, "failed", { currentTaskId: null });
    appendSessionEvent({ sessionId, agentId: agent.id, taskId, type: "task.failed", payload: { error: message } });
    throw err;
  }
}
