import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import * as sessionStore from "./agentSessionStore.js";
import * as registry from "./agentRegistry.js";

function makeUser() {
  const userId = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, 'x', 'Test User')").run(
    userId,
    `${userId}@example.test`
  );
  return userId;
}

describe("agentRegistry", () => {
  let userId: string;
  let sessionId: string;

  beforeEach(() => {
    userId = makeUser();
    sessionId = sessionStore.createSession({ userId, objective: "test" }).id;
  });

  afterEach(() => {
    db.prepare("DELETE FROM users WHERE id = ?").run(userId); // cascades sessions/agents
  });

  it("spawns an agent as a plain row in 'idle' status, using the role catalog's defaults", () => {
    const agent = registry.spawnAgent(sessionId, "coder");
    expect(agent.status).toBe("idle");
    expect(agent.displayName).toBe("Coder");
    expect(agent.capabilities).toEqual(["coding"]);
    expect(agent.permissions).toEqual(["file:read", "file:write", "exec:command"]);
    expect(agent.tokensUsed).toBe(0);
    expect(agent.modelProvider).toBeNull();
  });

  it("every one of the 14 catalog roles spawns a valid row", () => {
    for (const role of Object.keys(registry.ROLE_CATALOG) as registry.AgentRole[]) {
      const agent = registry.spawnAgent(sessionId, role);
      expect(agent.role).toBe(role);
      expect(agent.permissions.length).toBeGreaterThan(0);
    }
    expect(registry.listAgentsForSession(sessionId)).toHaveLength(14);
  });

  it("overrides display name and permissions when provided, without touching the catalog default elsewhere", () => {
    const custom = registry.spawnAgent(sessionId, "coder", {
      displayName: "Coder #2",
      permissions: ["file:read"],
    });
    expect(custom.displayName).toBe("Coder #2");
    expect(custom.permissions).toEqual(["file:read"]);

    const standard = registry.spawnAgent(sessionId, "coder");
    expect(standard.displayName).toBe("Coder");
    expect(standard.permissions).toEqual(["file:read", "file:write", "exec:command"]);
  });

  it("does not leak agents across sessions", () => {
    const other = sessionStore.createSession({ userId, objective: "other" }).id;
    const agent = registry.spawnAgent(sessionId, "qa");
    expect(registry.getAgent(sessionId, agent.id)).not.toBeNull();
    expect(registry.getAgent(other, agent.id)).toBeNull();
  });

  it("updates status, assigns a current task, and accumulates tokens_used additively", () => {
    const agent = registry.spawnAgent(sessionId, "architect");
    const task = sessionStore.createTask({ sessionId, title: "design it" });

    registry.updateAgentStatus(sessionId, agent.id, "working", {
      currentTaskId: task.id,
      addTokensUsed: 120,
      modelProvider: "gemini",
      modelId: "gemini-3.5-flash-lite",
    });
    const afterFirst = registry.getAgent(sessionId, agent.id)!;
    expect(afterFirst.status).toBe("working");
    expect(afterFirst.currentTaskId).toBe(task.id);
    expect(afterFirst.tokensUsed).toBe(120);
    expect(afterFirst.modelProvider).toBe("gemini");

    registry.updateAgentStatus(sessionId, agent.id, "completed", { addTokensUsed: 30 });
    const afterSecond = registry.getAgent(sessionId, agent.id)!;
    expect(afterSecond.status).toBe("completed");
    expect(afterSecond.tokensUsed).toBe(150); // additive, not overwritten
    expect(afterSecond.currentTaskId).toBe(task.id); // untouched when not passed again
    expect(afterSecond.modelProvider).toBe("gemini"); // COALESCE preserves it
  });

  it("hasPermission checks the role's actual granted list, not the catalog default", () => {
    const restricted = registry.spawnAgent(sessionId, "coder", { permissions: ["file:read"] });
    expect(registry.hasPermission(restricted, "file:read")).toBe(true);
    expect(registry.hasPermission(restricted, "exec:command")).toBe(false);
  });

  // The literal regression guard for architecture doc §6's central claim: creating many logical
  // agents costs SQLite row-writes only, never a model call or process. A generous wall-clock bound
  // (not a mock-call-count assertion) is the honest test here — this module doesn't import any
  // provider module at all, so there's nothing to spy on; elapsed time is the real, observable proxy.
  it("spawning 50 agents costs no measurable resources beyond the DB write", () => {
    const start = performance.now();
    for (let i = 0; i < 50; i++) {
      registry.spawnAgent(sessionId, "coder");
    }
    const elapsedMs = performance.now() - start;
    expect(registry.listAgentsForSession(sessionId)).toHaveLength(50);
    expect(elapsedMs).toBeLessThan(500); // 50 real model calls would never fit in this budget
  });
});
