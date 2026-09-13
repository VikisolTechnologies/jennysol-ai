import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import * as sessionStore from "./agentSessionStore.js";
import { spawnAgent } from "./agentRegistry.js";
import { __resetSchedulerForTests } from "./agentScheduler.js";
import {
  driveSession,
  isDrivingSession,
  __resetSessionRunnerForTests,
  __setTickIntervalMsForTests,
} from "./agentSessionRunner.js";

function makeUser() {
  const userId = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, 'x', 'Test User')").run(
    userId,
    `${userId}@example.test`
  );
  return userId;
}

// Instantly resolves every task as completed — this suite's job is proving the LOOP (keeps ticking,
// stops at the right time, respects pause/cancel), not re-testing runRoleTask's own real execution
// (agentOrchestrator.test.ts already does that for real).
function instantSuccessExecutor(sessionId: string, taskId: string): Promise<void> {
  sessionStore.updateTaskStatus(sessionId, taskId, "completed");
  return Promise.resolve();
}

function instantFailureExecutor(sessionId: string, taskId: string): Promise<void> {
  sessionStore.updateTaskStatus(sessionId, taskId, "failed");
  return Promise.reject(new Error("simulated failure"));
}

describe("agentSessionRunner", () => {
  let userId: string;
  let sessionId: string;

  beforeEach(() => {
    userId = makeUser();
    sessionId = sessionStore.createSession({ userId, objective: "test" }).id;
    sessionStore.updateSessionStatus(sessionId, "running");
    __resetSchedulerForTests();
    __resetSessionRunnerForTests();
    __setTickIntervalMsForTests(20);
  });

  afterEach(() => {
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
    __resetSchedulerForTests();
    __resetSessionRunnerForTests();
  });

  it("drives a real dependency chain to completion, marking the session completed", async () => {
    const agent = spawnAgent(sessionId, "coder");
    const t1 = sessionStore.createTask({ sessionId, title: "first" });
    sessionStore.updateTaskStatus(sessionId, t1.id, "pending", { agentId: agent.id });
    const t2 = sessionStore.createTask({ sessionId, title: "second", dependsOn: [t1.id] });
    sessionStore.updateTaskStatus(sessionId, t2.id, "pending", { agentId: agent.id });

    await driveSession(sessionId, instantSuccessExecutor);

    expect(sessionStore.getSessionUnscoped(sessionId)!.status).toBe("completed");
    expect(sessionStore.getTask(sessionId, t1.id)!.status).toBe("completed");
    expect(sessionStore.getTask(sessionId, t2.id)!.status).toBe("completed");
  });

  it("marks the session failed when any task ends up failed, not completed", async () => {
    const agent = spawnAgent(sessionId, "coder");
    const t1 = sessionStore.createTask({ sessionId, title: "will fail" });
    sessionStore.updateTaskStatus(sessionId, t1.id, "pending", { agentId: agent.id });

    await driveSession(sessionId, instantFailureExecutor);

    expect(sessionStore.getSessionUnscoped(sessionId)!.status).toBe("failed");
  });

  it("stops driving (and stays idle) once a human pauses the session, never marking it done early", async () => {
    const agent = spawnAgent(sessionId, "coder");
    let releaseTask: (() => void) | null = null;
    const blockingExecutor = (sid: string, taskId: string) =>
      new Promise<void>((resolve) => {
        releaseTask = () => {
          sessionStore.updateTaskStatus(sid, taskId, "completed");
          resolve();
        };
      });

    const t1 = sessionStore.createTask({ sessionId, title: "blocked on purpose" });
    sessionStore.updateTaskStatus(sessionId, t1.id, "pending", { agentId: agent.id });

    const drivePromise = driveSession(sessionId, blockingExecutor);
    // Give the loop one real tick to dispatch the task and start blocking on it.
    await new Promise((r) => setTimeout(r, 50));
    expect(isDrivingSession(sessionId)).toBe(true);

    sessionStore.updateSessionStatus(sessionId, "paused");
    // While paused, the loop must not touch session/task state even though the task is still
    // in-flight underneath it.
    await new Promise((r) => setTimeout(r, 100));
    expect(sessionStore.getSessionUnscoped(sessionId)!.status).toBe("paused");
    expect(sessionStore.getTask(sessionId, t1.id)!.status).toBe("running");

    releaseTask!();
    sessionStore.updateSessionStatus(sessionId, "running");
    await drivePromise;

    expect(sessionStore.getSessionUnscoped(sessionId)!.status).toBe("completed");
  });

  it("stops driving immediately once the session is cancelled out from under it", async () => {
    const agent = spawnAgent(sessionId, "coder");
    let releaseTask: (() => void) | null = null;
    const blockingExecutor = (sid: string, taskId: string) =>
      new Promise<void>((resolve) => {
        releaseTask = () => resolve();
      });

    const t1 = sessionStore.createTask({ sessionId, title: "cancel me" });
    sessionStore.updateTaskStatus(sessionId, t1.id, "pending", { agentId: agent.id });

    const drivePromise = driveSession(sessionId, blockingExecutor);
    await new Promise((r) => setTimeout(r, 50));
    expect(isDrivingSession(sessionId)).toBe(true);

    sessionStore.updateSessionStatus(sessionId, "cancelled");
    releaseTask?.();
    await drivePromise;

    expect(isDrivingSession(sessionId)).toBe(false);
    // The loop noticed the terminal status and returned without overwriting it back to completed.
    expect(sessionStore.getSessionUnscoped(sessionId)!.status).toBe("cancelled");
  });

  it("never runs two competing drive loops for the same session", async () => {
    const agent = spawnAgent(sessionId, "coder");
    const t1 = sessionStore.createTask({ sessionId, title: "only once" });
    sessionStore.updateTaskStatus(sessionId, t1.id, "pending", { agentId: agent.id });

    let callCount = 0;
    const countingExecutor = (sid: string, taskId: string) => {
      callCount++;
      return instantSuccessExecutor(sid, taskId);
    };

    await Promise.all([driveSession(sessionId, countingExecutor), driveSession(sessionId, countingExecutor)]);

    expect(callCount).toBe(1);
    expect(sessionStore.getSessionUnscoped(sessionId)!.status).toBe("completed");
  });
});
