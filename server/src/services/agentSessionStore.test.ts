import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";

// Same real-SQLite discipline as agentRunStore.test.ts — this store's whole job is durable
// cross-session persistence, so it isn't worth testing against a mock of itself.
import { db } from "../db/index.js";
import * as sessionStore from "./agentSessionStore.js";

function makeUser() {
  const userId = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, 'x', 'Test User')").run(
    userId,
    `${userId}@example.test`
  );
  return userId;
}

// agent_tasks.agent_id has a real FK to agents(id) (foreign_keys pragma is ON) — Phase 2 owns the
// agents-table CRUD, but Phase 1's own tests still need a real row to satisfy the constraint, same
// as agentRunStore.test.ts inserts a real user/conversation row directly rather than faking one.
function makeAgent(sessionId: string, id: string) {
  db.prepare("INSERT INTO agents (id, session_id, role, display_name) VALUES (?, ?, 'coder', 'Test Agent')").run(
    id,
    sessionId
  );
}

describe("agentSessionStore", () => {
  let userId: string;

  beforeEach(() => {
    userId = makeUser();
  });

  afterEach(() => {
    db.prepare("DELETE FROM users WHERE id = ?").run(userId); // cascades sessions/memory/tasks
  });

  it("creates a session in 'planning' status, scoped to its owner", () => {
    const session = sessionStore.createSession({ userId, objective: "Add a health-check endpoint" });
    expect(session.status).toBe("planning");
    expect(session.objective).toBe("Add a health-check endpoint");

    expect(sessionStore.getSession(userId, session.id)).not.toBeNull();
    expect(sessionStore.getSession(randomUUID(), session.id)).toBeNull(); // wrong user can't see it
  });

  it("persists budget caps and carries them through unchanged", () => {
    const session = sessionStore.createSession({
      userId,
      objective: "Bounded run",
      maxSessionTimeMs: 600_000,
      maxTokenBudget: 50_000,
      maxCost: 2.5,
      maxAgentCount: 12,
      maxConcurrentAgents: 3,
    });
    const read = sessionStore.getSession(userId, session.id)!;
    expect(read.maxSessionTimeMs).toBe(600_000);
    expect(read.maxTokenBudget).toBe(50_000);
    expect(read.maxCost).toBe(2.5);
    expect(read.maxAgentCount).toBe(12);
    expect(read.maxConcurrentAgents).toBe(3);
  });

  it("walks planning -> running -> completed and stamps completed_at only on a terminal status", () => {
    const session = sessionStore.createSession({ userId, objective: "x" });
    sessionStore.updateSessionStatus(session.id, "running");
    expect(sessionStore.getSession(userId, session.id)!.status).toBe("running");
    expect(sessionStore.getSession(userId, session.id)!.completedAt).toBeNull();

    sessionStore.updateSessionStatus(session.id, "completed");
    const done = sessionStore.getSession(userId, session.id)!;
    expect(done.status).toBe("completed");
    expect(done.completedAt).not.toBeNull();
  });

  it("getSessionUnscoped/listAllSessions see a session regardless of which user it belongs to — admin-only surface", () => {
    const otherUserId = makeUser();
    const session = sessionStore.createSession({ userId: otherUserId, objective: "someone else's" });

    expect(sessionStore.getSessionUnscoped(session.id)?.id).toBe(session.id);
    expect(sessionStore.listAllSessions().map((s) => s.id)).toContain(session.id);

    db.prepare("DELETE FROM users WHERE id = ?").run(otherUserId);
  });

  it("lists a user's sessions newest-first", () => {
    const a = sessionStore.createSession({ userId, objective: "first" });
    const b = sessionStore.createSession({ userId, objective: "second" });
    const listed = sessionStore.listSessionsForUser(userId).map((s) => s.id);
    expect(listed.indexOf(b.id)).toBeLessThan(listed.indexOf(a.id));
  });

  describe("session_memory", () => {
    it("writes and reads a single key without disturbing others", () => {
      const session = sessionStore.createSession({ userId, objective: "x" });
      sessionStore.setMemory(session.id, "requirements", { must: ["a", "b"] }, "agent-1");
      sessionStore.setMemory(session.id, "architecture", { style: "monolith" });

      expect(sessionStore.getMemory(session.id, "requirements")!.value).toEqual({ must: ["a", "b"] });
      expect(sessionStore.getMemory(session.id, "requirements")!.updatedByAgentId).toBe("agent-1");
      expect(sessionStore.getMemory(session.id, "architecture")!.value).toEqual({ style: "monolith" });
      expect(sessionStore.listMemory(session.id)).toHaveLength(2);
    });

    it("upserts in place — writing the same key twice updates it, doesn't duplicate it", () => {
      const session = sessionStore.createSession({ userId, objective: "x" });
      sessionStore.setMemory(session.id, "current_plan", { step: 1 });
      sessionStore.setMemory(session.id, "current_plan", { step: 2 }, "agent-2");

      const entries = sessionStore.listMemory(session.id);
      expect(entries).toHaveLength(1);
      expect(entries[0].value).toEqual({ step: 2 });
      expect(entries[0].updatedByAgentId).toBe("agent-2");
    });

    it("does not leak memory across sessions", () => {
      const s1 = sessionStore.createSession({ userId, objective: "one" });
      const s2 = sessionStore.createSession({ userId, objective: "two" });
      sessionStore.setMemory(s1.id, "secret_plan", { onlyIn: "s1" });

      expect(sessionStore.getMemory(s2.id, "secret_plan")).toBeNull();
      expect(sessionStore.listMemory(s2.id)).toHaveLength(0);
    });
  });

  describe("agent_tasks", () => {
    it("creates tasks with dependencies and reads them back verbatim", () => {
      const session = sessionStore.createSession({ userId, objective: "x" });
      const t1 = sessionStore.createTask({ sessionId: session.id, title: "TASK-004" });
      const t2 = sessionStore.createTask({ sessionId: session.id, title: "TASK-005" });
      const t3 = sessionStore.createTask({
        sessionId: session.id,
        title: "TASK-006",
        dependsOn: [t1.id, t2.id],
        priority: 5,
      });

      const read = sessionStore.getTask(session.id, t3.id)!;
      expect(read.dependsOn).toEqual([t1.id, t2.id]);
      expect(read.priority).toBe(5);
      expect(read.status).toBe("pending");
    });

    it("lists all tasks for a session in creation order", () => {
      const session = sessionStore.createSession({ userId, objective: "x" });
      const t1 = sessionStore.createTask({ sessionId: session.id, title: "first" });
      const t2 = sessionStore.createTask({ sessionId: session.id, title: "second" });
      expect(sessionStore.listTasksForSession(session.id).map((t) => t.id)).toEqual([t1.id, t2.id]);
    });

    it("updates status and stamps started_at/completed_at only on the relevant transitions", () => {
      const session = sessionStore.createSession({ userId, objective: "x" });
      const task = sessionStore.createTask({ sessionId: session.id, title: "do work" });
      makeAgent(session.id, "agent-9");

      sessionStore.updateTaskStatus(session.id, task.id, "running", { agentId: "agent-9" });
      const running = sessionStore.getTask(session.id, task.id)!;
      expect(running.status).toBe("running");
      expect(running.agentId).toBe("agent-9");
      expect(running.startedAt).not.toBeNull();
      expect(running.completedAt).toBeNull();

      sessionStore.updateTaskStatus(session.id, task.id, "completed", { result: { diff: "ok" } });
      const done = sessionStore.getTask(session.id, task.id)!;
      expect(done.status).toBe("completed");
      expect(done.completedAt).not.toBeNull();
      expect(done.result).toEqual({ diff: "ok" });
      // agentId set on the earlier transition must survive an update that doesn't repeat it.
      expect(done.agentId).toBe("agent-9");
    });

    it("does not leak tasks across sessions — a task id from session A is invisible under session B", () => {
      const sA = sessionStore.createSession({ userId, objective: "A" });
      const sB = sessionStore.createSession({ userId, objective: "B" });
      const task = sessionStore.createTask({ sessionId: sA.id, title: "belongs to A" });

      expect(sessionStore.getTask(sA.id, task.id)).not.toBeNull();
      expect(sessionStore.getTask(sB.id, task.id)).toBeNull();
      expect(sessionStore.listTasksForSession(sB.id)).toHaveLength(0);
    });
  });
});
