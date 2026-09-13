import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import * as sessionStore from "./agentSessionStore.js";
import { spawnAgent } from "./agentRegistry.js";
import { getSessionEventsAfter } from "./sessionEventBus.js";
import { tick, getRunningCount, __setMaxConcurrentSlotsForTests, __resetSchedulerForTests } from "./agentScheduler.js";

function makeUser() {
  const userId = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, 'x', 'Test User')").run(
    userId,
    `${userId}@example.test`
  );
  return userId;
}

// A controllable stand-in for runAgentTask: records concurrency in real time (not simulated), and
// only resolves each call when the test explicitly releases it — this is what makes "never more than
// N running at once" a directly observable, deterministic assertion instead of a timing guess.
function makeControllableExecutor() {
  let current = 0;
  let maxObserved = 0;
  const releasers = new Map<string, () => void>();
  const started: string[] = [];

  const executor = (_sessionId: string, taskId: string) =>
    new Promise<void>((resolve) => {
      current++;
      maxObserved = Math.max(maxObserved, current);
      started.push(taskId);
      releasers.set(taskId, () => {
        current--;
        resolve();
      });
    });

  return {
    executor,
    release(taskId: string) {
      releasers.get(taskId)?.();
      releasers.delete(taskId);
    },
    get maxObserved() {
      return maxObserved;
    },
    get started() {
      return started;
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("agentScheduler", () => {
  let userId: string;
  let sessionId: string;

  beforeEach(() => {
    userId = makeUser();
    sessionId = sessionStore.createSession({ userId, objective: "test" }).id;
    __resetSchedulerForTests();
  });

  afterEach(() => {
    __resetSchedulerForTests();
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  });

  function makeReadyTask(title: string, priority = 0) {
    const agent = spawnAgent(sessionId, "coder");
    const task = sessionStore.createTask({ sessionId, title, priority });
    sessionStore.updateTaskStatus(sessionId, task.id, "pending", { agentId: agent.id });
    return task;
  }

  it("dispatches at most the hardware-permitted number of tasks at once, never more", async () => {
    __setMaxConcurrentSlotsForTests(2);
    const tasks = [makeReadyTask("t1"), makeReadyTask("t2"), makeReadyTask("t3"), makeReadyTask("t4"), makeReadyTask("t5")];
    const ctl = makeControllableExecutor();

    const result = await tick(sessionId, ctl.executor);
    expect(result.dispatched).toHaveLength(2);
    expect(getRunningCount()).toBe(2);

    // The other 3 were left alone — still real, unstarted, pending tasks, not silently dropped.
    const remaining = tasks.map((t) => t.id).filter((id) => !result.dispatched.includes(id));
    expect(remaining).toHaveLength(3);
    for (const id of remaining) {
      expect(sessionStore.getTask(sessionId, id)!.status).toBe("pending");
    }

    // A second tick before anything finishes must grant nothing more — both real slots are held.
    const secondTick = await tick(sessionId, ctl.executor);
    expect(secondTick.dispatched).toHaveLength(0);
    expect(ctl.maxObserved).toBe(2); // never exceeded, observed in real time, not asserted after the fact

    // Free one slot — the next tick should pick up exactly one more from the remaining pool.
    ctl.release(result.dispatched[0]);
    await flush();
    expect(getRunningCount()).toBe(1);
    const thirdTick = await tick(sessionId, ctl.executor);
    expect(thirdTick.dispatched).toHaveLength(1);
    expect(ctl.maxObserved).toBe(2); // still never exceeded across the whole run

    // Drain the rest so nothing leaks into other tests via the global counter.
    for (const id of [...result.dispatched, ...thirdTick.dispatched]) ctl.release(id);
    await flush();
  });

  it("dispatches in priority order (highest first), then FIFO for ties", async () => {
    __setMaxConcurrentSlotsForTests(1);
    const low = makeReadyTask("low", 1);
    const high = makeReadyTask("high", 10);
    makeReadyTask("medium", 5);
    const ctl = makeControllableExecutor();

    const result = await tick(sessionId, ctl.executor);
    expect(result.dispatched).toEqual([high.id]);
    ctl.release(high.id);
    await flush();

    const second = await tick(sessionId, ctl.executor);
    expect(second.dispatched[0]).not.toBe(low.id); // "medium" (priority 5) must come before "low" (priority 1)
    ctl.release(second.dispatched[0]);
    await flush();
  });

  it("never dispatches a ready task with no agent assigned", async () => {
    __setMaxConcurrentSlotsForTests(5);
    const unassigned = sessionStore.createTask({ sessionId, title: "orphan" }); // no agentId set
    const ctl = makeControllableExecutor();

    const result = await tick(sessionId, ctl.executor);
    expect(result.dispatched).not.toContain(unassigned.id);
    expect(sessionStore.getTask(sessionId, unassigned.id)!.status).toBe("pending");
  });

  it("writes a real task.ready event for each task actually granted a slot", async () => {
    __setMaxConcurrentSlotsForTests(1);
    const task = makeReadyTask("t1");
    const ctl = makeControllableExecutor();

    await tick(sessionId, ctl.executor);
    const events = getSessionEventsAfter(sessionId, 0);
    expect(events.map((e) => e.type)).toContain("task.ready");
    expect(events.find((e) => e.type === "task.ready")?.taskId).toBe(task.id);
    ctl.release(task.id);
    await flush();
  });

  it("stops granting slots once the session's token budget is exhausted, visibly — not a silent stall", async () => {
    const budgeted = sessionStore.createSession({ userId, objective: "budgeted", maxTokenBudget: 100 }).id;
    const agent = spawnAgent(budgeted, "coder");
    // Simulate tokens already spent by a prior task in this same session.
    const { updateAgentStatus } = await import("./agentRegistry.js");
    updateAgentStatus(budgeted, agent.id, "idle", { addTokensUsed: 150 });
    const task = sessionStore.createTask({ sessionId: budgeted, title: "t1" });
    sessionStore.updateTaskStatus(budgeted, task.id, "pending", { agentId: agent.id });

    const ctl = makeControllableExecutor();
    const result = await tick(budgeted, ctl.executor);

    expect(result.dispatched).toHaveLength(0);
    expect(result.pausedForBudget).toBe("tokens");
    expect(sessionStore.getSessionUnscoped(budgeted)!.status).toBe("paused");

    const events = getSessionEventsAfter(budgeted, 0);
    expect(events.some((e) => e.type === "session.status_changed")).toBe(true);
    expect(events.find((e) => e.type === "session.status_changed")?.payload).toMatchObject({
      status: "paused",
      reason: "budget_exceeded:tokens",
    });
  });

  it("stops granting slots once the session's max_session_time_ms has elapsed", async () => {
    const timeBoxed = sessionStore.createSession({ userId, objective: "time-boxed", maxSessionTimeMs: 1 }).id;
    await new Promise((r) => setTimeout(r, 5)); // guarantee real elapsed time exceeds 1ms
    const agent = spawnAgent(timeBoxed, "coder");
    const task = sessionStore.createTask({ sessionId: timeBoxed, title: "t1" });
    sessionStore.updateTaskStatus(timeBoxed, task.id, "pending", { agentId: agent.id });

    const result = await tick(timeBoxed, makeControllableExecutor().executor);
    expect(result.dispatched).toHaveLength(0);
    expect(result.pausedForBudget).toBe("time");
  });

  it("does not re-pause (or re-emit the event) on every tick once already paused for budget", async () => {
    const budgeted = sessionStore.createSession({ userId, objective: "budgeted", maxTokenBudget: 10 }).id;
    const agent = spawnAgent(budgeted, "coder");
    const { updateAgentStatus } = await import("./agentRegistry.js");
    updateAgentStatus(budgeted, agent.id, "idle", { addTokensUsed: 50 });

    await tick(budgeted, makeControllableExecutor().executor);
    await tick(budgeted, makeControllableExecutor().executor);

    const events = getSessionEventsAfter(budgeted, 0).filter((e) => e.type === "session.status_changed");
    expect(events).toHaveLength(1); // only the first tick's transition, not one per tick
  });

  it("shares one global slot pool across sessions — the hardware doesn't care which session asked first", async () => {
    __setMaxConcurrentSlotsForTests(1);
    const otherSessionId = sessionStore.createSession({ userId, objective: "other" }).id;
    const otherAgent = spawnAgent(otherSessionId, "coder");
    const otherTask = sessionStore.createTask({ sessionId: otherSessionId, title: "other-task" });
    sessionStore.updateTaskStatus(otherSessionId, otherTask.id, "pending", { agentId: otherAgent.id });

    makeReadyTask("this-session-task");
    const ctl = makeControllableExecutor();

    const first = await tick(sessionId, ctl.executor);
    expect(first.dispatched).toHaveLength(1); // took the one global slot

    const second = await tick(otherSessionId, ctl.executor);
    expect(second.dispatched).toHaveLength(0); // nothing left, even though it's a different session

    ctl.release(first.dispatched[0]);
    await flush();
    db.prepare("DELETE FROM agent_sessions WHERE id = ?").run(otherSessionId);
  });
});
