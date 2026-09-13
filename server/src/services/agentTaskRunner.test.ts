import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import * as sessionStore from "./agentSessionStore.js";
import { spawnAgent, getAgent } from "./agentRegistry.js";
import { getSessionEventsAfter } from "./sessionEventBus.js";

vi.mock("./modelRouter.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./modelRouter.js")>();
  return { ...actual, routeChatCompletion: vi.fn() };
});
import { routeChatCompletion, AllProvidersUnavailableError, type RouteResult } from "./modelRouter.js";
import { runAgentTask, AgentTaskError, MEMORY_READ_SCOPE } from "./agentTaskRunner.js";

const mockRoute = routeChatCompletion as unknown as ReturnType<typeof vi.fn>;

function makeUser() {
  const userId = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, 'x', 'Test User')").run(
    userId,
    `${userId}@example.test`
  );
  return userId;
}

describe("agentTaskRunner (mocked router — deterministic bookkeeping)", () => {
  let userId: string;
  let sessionId: string;

  beforeEach(() => {
    userId = makeUser();
    sessionId = sessionStore.createSession({ userId, objective: "test" }).id;
    mockRoute.mockReset();
  });

  afterEach(() => {
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  });

  it("rejects a task with no agent assigned, touching nothing", async () => {
    const task = sessionStore.createTask({ sessionId, title: "unassigned" });
    await expect(runAgentTask(sessionId, task.id)).rejects.toThrow(AgentTaskError);
    expect(mockRoute).not.toHaveBeenCalled();
  });

  it("only reads the memory keys declared for the agent's role, not the whole session", async () => {
    const agent = spawnAgent(sessionId, "coder");
    const task = sessionStore.createTask({ sessionId, title: "do it" });
    sessionStore.updateTaskStatus(sessionId, task.id, "pending", { agentId: agent.id });

    sessionStore.setMemory(sessionId, "architecture", { style: "monolith" }); // in coder's scope
    sessionStore.setMemory(sessionId, "audit_results", { pass: true }); // NOT in coder's scope

    mockRoute.mockImplementation(async (systemPrompt: string) => {
      expect(systemPrompt).toContain("monolith");
      expect(systemPrompt).not.toContain("audit_results");
      expect(systemPrompt).not.toContain('"pass"');
      return { providerUsed: "gemini", fellBack: false, taskCapability: "coding", attempts: [] } as RouteResult;
    });

    await runAgentTask(sessionId, task.id);
    expect(mockRoute).toHaveBeenCalledTimes(1);
    expect(MEMORY_READ_SCOPE.coder).toContain("architecture");
    expect(MEMORY_READ_SCOPE.coder).not.toContain("audit_results");
  });

  it("walks running -> completed on success, with real events matching what happened", async () => {
    const agent = spawnAgent(sessionId, "coder");
    const task = sessionStore.createTask({ sessionId, title: "add health check" });
    sessionStore.updateTaskStatus(sessionId, task.id, "pending", { agentId: agent.id });

    mockRoute.mockImplementation(async (_sys: string, _hist: unknown, onDelta: (t: string) => void) => {
      onDelta("Here's ");
      onDelta("the diff.");
      return {
        providerUsed: "gemini",
        model: undefined,
        fellBack: false,
        taskCapability: "coding",
        attempts: [],
        totalMs: 42,
        usage: { promptTokens: 10, completionTokens: 5, estimated: false },
      } as RouteResult;
    });

    await runAgentTask(sessionId, task.id);

    const finishedTask = sessionStore.getTask(sessionId, task.id)!;
    expect(finishedTask.status).toBe("completed");
    expect(finishedTask.result).toEqual({ response: "Here's the diff.", provider: "gemini" });

    const finishedAgent = getAgent(sessionId, agent.id)!;
    expect(finishedAgent.status).toBe("completed");
    expect(finishedAgent.tokensUsed).toBe(15);
    expect(finishedAgent.currentTaskId).toBeNull();

    const events = getSessionEventsAfter(sessionId, 0);
    expect(events.map((e) => e.type)).toEqual(["task.started", "task.completed"]);
    expect(events[1].payload).toMatchObject({ provider: "gemini", totalMs: 42 });
  });

  it("marks the task failed with the real error attached — never silently retried or swallowed", async () => {
    const agent = spawnAgent(sessionId, "coder");
    const task = sessionStore.createTask({ sessionId, title: "will fail" });
    sessionStore.updateTaskStatus(sessionId, task.id, "pending", { agentId: agent.id });

    mockRoute.mockRejectedValue(
      new AllProvidersUnavailableError([{ name: "gemini", reason: "in cooldown" }])
    );

    await expect(runAgentTask(sessionId, task.id)).rejects.toThrow(AllProvidersUnavailableError);

    const finishedTask = sessionStore.getTask(sessionId, task.id)!;
    expect(finishedTask.status).toBe("failed");
    expect((finishedTask.result as { error: string }).error).toContain("All configured AI providers");
    expect((finishedTask.result as { error: string }).error).toContain("in cooldown");

    const finishedAgent = getAgent(sessionId, agent.id)!;
    expect(finishedAgent.status).toBe("failed");

    const events = getSessionEventsAfter(sessionId, 0);
    expect(events.map((e) => e.type)).toEqual(["task.started", "task.failed"]);
    expect((events[1].payload as { error: string }).error).toContain("in cooldown");
  });
});

// The genuinely live-fire test this phase's own plan calls for ("the first phase with something
// genuinely worth a live-fire test") — real network call to this Mac's real local Ollama instance,
// no mocking. Skips (loudly, not silently) if Ollama isn't reachable from wherever this suite runs,
// rather than hard-failing on a machine/CI environment without it.
const OLLAMA_URL = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const ollamaReachable = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) })
  .then((r) => r.ok)
  .catch(() => false);

if (!ollamaReachable) {
  // eslint-disable-next-line no-console
  console.warn(`[agentTaskRunner.test] Skipping live Ollama test — ${OLLAMA_URL} not reachable from this machine.`);
}

describe.skipIf(!ollamaReachable)("runAgentTask — real, live model call (no mocking)", () => {
  it("runs a real task through a real local model and produces events matching what actually happened", async () => {
    vi.doUnmock("./modelRouter.js");
    vi.resetModules();
    const originalChain = process.env.LLM_PROVIDER_CHAIN;
    const originalBaseUrl = process.env.OLLAMA_BASE_URL;
    const originalLocalTimeout = process.env.LLM_LOCAL_FIRST_TOKEN_TIMEOUT_MS;
    process.env.LLM_PROVIDER_CHAIN = "ollama";
    process.env.OLLAMA_BASE_URL = OLLAMA_URL;
    // This test's job is proving runAgentTask's wiring is correct end-to-end against a real model
    // call — NOT re-validating the production LLM_LOCAL_FIRST_TOKEN_TIMEOUT_MS=2500 cold-start
    // budget, which is a separate, already-made, already-documented tuning decision (see
    // BLOCKERS.md's hedging item and JENNY_MODEL_FLEET.md) tuned for production traffic with a
    // live keep-warm prober running ahead of it — a condition this isolated one-off test process
    // doesn't have. Observed directly while writing this test: even a just-warmed local model on
    // this real, resource-shared Mac took a bit over 2500ms twice in a row here, which is a real
    // fact about this specific machine right now, not a bug in the router. Widening the budget for
    // this test only keeps the two concerns separate.
    process.env.LLM_LOCAL_FIRST_TOKEN_TIMEOUT_MS = "20000";

    // Re-import against the real (unmocked) module graph now that the env vars driving provider
    // selection are set — the top-of-file import is the vi.mock'd version used by the suite above.
    const freshSessionStore = await import("./agentSessionStore.js");
    const freshRegistry = await import("./agentRegistry.js");
    const freshBus = await import("./sessionEventBus.js");
    const { runAgentTask: freshRunAgentTask } = await import("./agentTaskRunner.js");
    const { isOllamaAvailable } = await import("./providers/ollama.js");

    // ollama.ts's own module-load reachability probe is deliberately fire-and-forget (a live chat
    // request must never block on it — see that file's own comment on this exact race for a
    // short-lived process asking before the probe resolves). This test process is exactly that
    // short-lived case after vi.resetModules(), so it polls the same real function production code
    // uses until the real probe actually resolves, instead of racing it.
    const deadline = Date.now() + 5000;
    while (!isOllamaAvailable() && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(isOllamaAvailable()).toBe(true);

    const userId = makeUser();
    try {
      const session = freshSessionStore.createSession({ userId, objective: "live test" });
      const agent = freshRegistry.spawnAgent(session.id, "coder");

      // A genuinely cold local model can take longer to load than LLM_LOCAL_FIRST_TOKEN_TIMEOUT_MS
      // allows (a real, already-documented characteristic of this router, not a bug in this test —
      // see JENNY_MODEL_FLEET.md/keepWarm.ts, which exists in production specifically because of
      // this) — a short-lived test process has no keep-warm prober running ahead of it. Give it one
      // real attempt to load; if that one times out, the model is now warm server-side for the real
      // assertion attempt right after.
      const warmupTask = freshSessionStore.createTask({ sessionId: session.id, title: "warm the model up" });
      freshSessionStore.updateTaskStatus(session.id, warmupTask.id, "pending", { agentId: agent.id });
      await freshRunAgentTask(session.id, warmupTask.id).catch(() => {});

      const task = freshSessionStore.createTask({ sessionId: session.id, title: "Say the word 'ready' and nothing else." });
      freshSessionStore.updateTaskStatus(session.id, task.id, "pending", { agentId: agent.id });

      await freshRunAgentTask(session.id, task.id);

      const finishedTask = freshSessionStore.getTask(session.id, task.id)!;
      expect(finishedTask.status).toBe("completed");
      expect(typeof (finishedTask.result as { response: string }).response).toBe("string");
      expect((finishedTask.result as { response: string }).response.length).toBeGreaterThan(0);

      const finishedAgent = freshRegistry.getAgent(session.id, agent.id)!;
      expect(finishedAgent.status).toBe("completed");
      expect(finishedAgent.modelProvider).toBe("ollama");

      // Scoped to this specific task's own events — the session also carries the earlier warmup
      // task's real task.started/task.completed pair, which is expected, not a leak.
      const events = freshBus.getSessionEventsAfter(session.id, 0).filter((e) => e.taskId === task.id);
      expect(events.map((e) => e.type)).toEqual(["task.started", "task.completed"]);
    } finally {
      db.prepare("DELETE FROM users WHERE id = ?").run(userId);
      if (originalChain === undefined) delete process.env.LLM_PROVIDER_CHAIN;
      else process.env.LLM_PROVIDER_CHAIN = originalChain;
      if (originalBaseUrl === undefined) delete process.env.OLLAMA_BASE_URL;
      else process.env.OLLAMA_BASE_URL = originalBaseUrl;
      if (originalLocalTimeout === undefined) delete process.env.LLM_LOCAL_FIRST_TOKEN_TIMEOUT_MS;
      else process.env.LLM_LOCAL_FIRST_TOKEN_TIMEOUT_MS = originalLocalTimeout;
    }
  }, 45_000);
});
