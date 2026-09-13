import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import * as sessionStore from "./agentSessionStore.js";
import { requestLock, releaseLock, isLocked, __clearWaitersForTests } from "./agentFileLocks.js";
import { getSessionEventsAfter } from "./sessionEventBus.js";

function makeUser() {
  const userId = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, 'x', 'Test User')").run(
    userId,
    `${userId}@example.test`
  );
  return userId;
}

function makeAgent(sessionId: string) {
  const id = randomUUID();
  db.prepare("INSERT INTO agents (id, session_id, role, display_name) VALUES (?, ?, 'coder', 'Test Agent')").run(
    id,
    sessionId
  );
  return id;
}

describe("agentFileLocks", () => {
  let userId: string;
  let sessionId: string;

  beforeEach(() => {
    userId = makeUser();
    sessionId = sessionStore.createSession({ userId, objective: "test" }).id;
    __clearWaitersForTests();
  });

  afterEach(() => {
    __clearWaitersForTests();
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  });

  it("grants an unheld lock immediately", () => {
    const agentA = makeAgent(sessionId);
    const result = requestLock(sessionId, "src/index.ts", agentA);
    expect(result.outcome).toBe("acquired");
    expect(isLocked(sessionId, "src/index.ts")).toBe(true);
  });

  it("is re-entrant — the current holder requesting again is not made to wait on itself", () => {
    const agentA = makeAgent(sessionId);
    requestLock(sessionId, "src/index.ts", agentA);
    const again = requestLock(sessionId, "src/index.ts", agentA);
    expect(again.outcome).toBe("acquired");
  });

  it("the literal §12 test: a second agent gets a real WAIT, then acquires the moment the first releases", async () => {
    const agentA = makeAgent(sessionId);
    const agentB = makeAgent(sessionId);

    const first = requestLock(sessionId, "src/index.ts", agentA);
    expect(first.outcome).toBe("acquired");

    const second = requestLock(sessionId, "src/index.ts", agentB);
    expect(second.outcome).toBe("wait");

    let secondGranted = false;
    second.granted.then(() => {
      secondGranted = true;
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(secondGranted).toBe(false); // still waiting — A hasn't released yet

    releaseLock(sessionId, "src/index.ts", agentA);
    await second.granted; // resolves now, not before

    expect(secondGranted).toBe(true);
    expect(isLocked(sessionId, "src/index.ts")).toBe(true); // now held by B

    const events = getSessionEventsAfter(sessionId, 0);
    const forB = events.filter((e) => e.agentId === agentB);
    expect(forB.map((e) => ({ type: e.type, status: (e.payload as { status?: string })?.status }))).toEqual([
      { type: "file.locked", status: "wait" },
      { type: "file.locked", status: "acquired" },
    ]);
  });

  it("queues multiple waiters and grants them in request order", async () => {
    const agentA = makeAgent(sessionId);
    const agentB = makeAgent(sessionId);
    const agentC = makeAgent(sessionId);

    requestLock(sessionId, "f.ts", agentA);
    const bReq = requestLock(sessionId, "f.ts", agentB);
    const cReq = requestLock(sessionId, "f.ts", agentC);

    const order: string[] = [];
    bReq.granted.then(() => order.push("B"));
    cReq.granted.then(() => order.push("C"));

    releaseLock(sessionId, "f.ts", agentA);
    await bReq.granted;
    releaseLock(sessionId, "f.ts", agentB);
    await cReq.granted;

    expect(order).toEqual(["B", "C"]);
  });

  it("releasing from a non-holder is a harmless no-op, not an error", () => {
    const agentA = makeAgent(sessionId);
    const agentB = makeAgent(sessionId);
    requestLock(sessionId, "f.ts", agentA);
    expect(() => releaseLock(sessionId, "f.ts", agentB)).not.toThrow();
    expect(isLocked(sessionId, "f.ts")).toBe(true); // still held by A
  });

  it("scopes locks per session — the same path in a different session is independent", () => {
    const otherSessionId = sessionStore.createSession({ userId, objective: "other" }).id;
    const agentA = makeAgent(sessionId);
    requestLock(sessionId, "f.ts", agentA);
    expect(isLocked(otherSessionId, "f.ts")).toBe(false);
  });
});
