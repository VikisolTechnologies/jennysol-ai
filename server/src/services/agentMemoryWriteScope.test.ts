import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import * as sessionStore from "./agentSessionStore.js";
import { spawnAgent } from "./agentRegistry.js";
import { getSessionEventsAfter } from "./sessionEventBus.js";
import { writeSessionMemory, MemoryScopeError } from "./agentMemoryWriteScope.js";

function makeUser() {
  const userId = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, 'x', 'Test User')").run(
    userId,
    `${userId}@example.test`
  );
  return userId;
}

describe("agentMemoryWriteScope", () => {
  let userId: string;
  let sessionId: string;

  beforeEach(() => {
    userId = makeUser();
    sessionId = sessionStore.createSession({ userId, objective: "test" }).id;
  });

  afterEach(() => {
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  });

  it("lets a role write a key inside its own declared scope, and records a real memory.updated event", () => {
    const coder = spawnAgent(sessionId, "coder");
    writeSessionMemory(sessionId, coder.id, "changed_files", ["a.ts"]);

    expect(sessionStore.getMemory(sessionId, "changed_files")?.value).toEqual(["a.ts"]);
    const events = getSessionEventsAfter(sessionId, 0);
    expect(events.some((e) => e.type === "memory.updated" && (e.payload as { key: string }).key === "changed_files")).toBe(true);
  });

  // The explicit violation case the brief asks for, not just the happy path: coder has no
  // "memory:write_any" permission (agentRegistry.ts's ROLE_CATALOG) and "architecture" is not in its
  // own declared scope — this must be refused, not silently allowed because the caller asked nicely.
  it("refuses a role writing a key outside its own scope — the real violation case", () => {
    const coder = spawnAgent(sessionId, "coder");
    expect(() => writeSessionMemory(sessionId, coder.id, "architecture", { note: "smuggled in" })).toThrow(MemoryScopeError);
    expect(sessionStore.getMemory(sessionId, "architecture")).toBeNull();
  });

  it("lets a memory:write_any role (architect) write a key outside coder's normal scope", () => {
    const architect = spawnAgent(sessionId, "architect");
    expect(() => writeSessionMemory(sessionId, architect.id, "architecture", { note: "ok" })).not.toThrow();
    expect(sessionStore.getMemory(sessionId, "architecture")?.value).toEqual({ note: "ok" });
  });

  // "An agent must not be able to write outside its scope by manipulating ... an id" (brief §5.2) —
  // an agent id that's real, but belongs to a DIFFERENT session, must not be usable to write into
  // this one just by passing this session's id alongside it.
  it("refuses an agent id manipulated to point at the wrong session", () => {
    const otherUserId = makeUser();
    try {
      const otherSessionId = sessionStore.createSession({ userId: otherUserId, objective: "other" }).id;
      const foreignCoder = spawnAgent(otherSessionId, "coder");

      expect(() => writeSessionMemory(sessionId, foreignCoder.id, "changed_files", ["x.ts"])).toThrow(MemoryScopeError);
      expect(sessionStore.getMemory(sessionId, "changed_files")).toBeNull();
    } finally {
      db.prepare("DELETE FROM users WHERE id = ?").run(otherUserId);
    }
  });

  it("throws on a completely unknown agent id rather than a silent no-op", () => {
    expect(() => writeSessionMemory(sessionId, randomUUID(), "changed_files", ["x.ts"])).toThrow(MemoryScopeError);
  });
});
