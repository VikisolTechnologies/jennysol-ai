import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import * as sessionStore from "./agentSessionStore.js";
import { spawnAgent, getAgent, updateAgentStatus } from "./agentRegistry.js";
import { requestLock, isLocked } from "./agentFileLocks.js";
import { proposeAgentAction, awaitApprovalDecision, listPendingActions } from "./agentToolRegistry.js";
import { getSessionEventsAfter } from "./sessionEventBus.js";
import { pauseSession, resumeSession, cancelSession, killAgent, SessionControlError } from "./agentSessionControl.js";

function makeUser() {
  const userId = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, 'x', 'Test User')").run(
    userId,
    `${userId}@example.test`
  );
  return userId;
}

describe("agentSessionControl", () => {
  let userId: string;
  let sessionId: string;

  beforeEach(() => {
    userId = makeUser();
    sessionId = sessionStore.createSession({ userId, objective: "test" }).id;
  });

  afterEach(() => {
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  });

  describe("pauseSession / resumeSession", () => {
    it("pauses a running session and records a real event", () => {
      sessionStore.updateSessionStatus(sessionId, "running");
      pauseSession(sessionId);
      expect(sessionStore.getSessionUnscoped(sessionId)!.status).toBe("paused");
      const events = getSessionEventsAfter(sessionId, 0);
      expect(events.some((e) => e.type === "session.status_changed" && (e.payload as { status: string }).status === "paused")).toBe(true);
    });

    it("resumes a paused session back to running", () => {
      sessionStore.updateSessionStatus(sessionId, "paused");
      resumeSession(sessionId);
      expect(sessionStore.getSessionUnscoped(sessionId)!.status).toBe("running");
    });

    it("refuses to resume a session that isn't paused, rather than silently no-op-ing", () => {
      sessionStore.updateSessionStatus(sessionId, "running");
      expect(() => resumeSession(sessionId)).toThrow(SessionControlError);
    });

    it("refuses to pause a session that's already completed", () => {
      sessionStore.updateSessionStatus(sessionId, "completed");
      expect(() => pauseSession(sessionId)).toThrow(SessionControlError);
    });

    it("throws on an unknown session id rather than a silent success", () => {
      expect(() => pauseSession(randomUUID())).toThrow(SessionControlError);
    });
  });

  describe("cancelSession", () => {
    it("cancels every non-terminal task and agent, releases locks, and rejects pending actions", async () => {
      const agent = spawnAgent(sessionId, "coder");
      const runningTask = sessionStore.createTask({ sessionId, title: "in progress" });
      sessionStore.updateTaskStatus(sessionId, runningTask.id, "running", { agentId: agent.id });
      const doneTask = sessionStore.createTask({ sessionId, title: "already done" });
      sessionStore.updateTaskStatus(sessionId, doneTask.id, "completed");

      requestLock(sessionId, "some/file.ts", agent.id);
      expect(isLocked(sessionId, "some/file.ts")).toBe(true);

      const action = proposeAgentAction(sessionId, agent.id, "file.write", { filePath: "x.txt", content: "y" });
      const decision = awaitApprovalDecision(action.id);

      cancelSession(sessionId);

      expect(sessionStore.getSessionUnscoped(sessionId)!.status).toBe("cancelled");
      expect(sessionStore.getTask(sessionId, runningTask.id)!.status).toBe("cancelled");
      // A task that was already terminal before the cancel is left alone — cancelling a finished
      // run must not rewrite real history.
      expect(sessionStore.getTask(sessionId, doneTask.id)!.status).toBe("completed");
      expect(getAgent(sessionId, agent.id)!.status).toBe("cancelled");
      expect(isLocked(sessionId, "some/file.ts")).toBe(false);
      expect(listPendingActions(sessionId)).toHaveLength(0);
      await expect(decision).resolves.toEqual({ approved: false });
    });

    it("cancelling an already-completed session is a harmless no-op, not an error", () => {
      sessionStore.updateSessionStatus(sessionId, "completed");
      expect(() => cancelSession(sessionId)).not.toThrow();
      expect(sessionStore.getSessionUnscoped(sessionId)!.status).toBe("completed");
    });
  });

  describe("killAgent", () => {
    it("cancels only the targeted agent's own current task, locks, and pending actions — siblings untouched", async () => {
      const target = spawnAgent(sessionId, "coder");
      const sibling = spawnAgent(sessionId, "qa");
      const targetTask = sessionStore.createTask({ sessionId, title: "target's task" });
      sessionStore.updateTaskStatus(sessionId, targetTask.id, "running", { agentId: target.id });
      updateAgentStatus(sessionId, target.id, "working", { currentTaskId: targetTask.id });
      const siblingTask = sessionStore.createTask({ sessionId, title: "sibling's task" });
      sessionStore.updateTaskStatus(sessionId, siblingTask.id, "running", { agentId: sibling.id });
      updateAgentStatus(sessionId, sibling.id, "working", { currentTaskId: siblingTask.id });

      requestLock(sessionId, "target-only.ts", target.id);
      requestLock(sessionId, "sibling-only.ts", sibling.id);
      const action = proposeAgentAction(sessionId, target.id, "file.write", { filePath: "z.txt", content: "w" });
      const decision = awaitApprovalDecision(action.id);

      killAgent(sessionId, target.id);

      expect(getAgent(sessionId, target.id)!.status).toBe("cancelled");
      expect(sessionStore.getTask(sessionId, targetTask.id)!.status).toBe("cancelled");
      expect(isLocked(sessionId, "target-only.ts")).toBe(false);
      await expect(decision).resolves.toEqual({ approved: false });

      // The sibling agent, its own running task, and its own lock are completely untouched.
      expect(getAgent(sessionId, sibling.id)!.status).toBe("working");
      expect(sessionStore.getTask(sessionId, siblingTask.id)!.status).toBe("running");
      expect(isLocked(sessionId, "sibling-only.ts")).toBe(true);
    });

    it("throws on an unknown agent id rather than a silent success", () => {
      expect(() => killAgent(sessionId, randomUUID())).toThrow(SessionControlError);
    });
  });
});
