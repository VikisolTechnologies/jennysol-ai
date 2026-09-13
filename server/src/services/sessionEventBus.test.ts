import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import * as sessionStore from "./agentSessionStore.js";
import * as bus from "./sessionEventBus.js";

function makeUser() {
  const userId = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, 'x', 'Test User')").run(
    userId,
    `${userId}@example.test`
  );
  return userId;
}

describe("sessionEventBus", () => {
  let userId: string;
  let sessionId: string;

  beforeEach(() => {
    userId = makeUser();
    sessionId = sessionStore.createSession({ userId, objective: "test" }).id;
  });

  afterEach(() => {
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  });

  it("writes durably before publishing — the row already exists when a live subscriber's handler fires", () => {
    let sawRowInDbDuringHandler = false;
    const unsubscribe = bus.subscribeToSession(sessionId, (event) => {
      const row = db.prepare("SELECT * FROM agent_session_events WHERE id = ?").get(event.id);
      sawRowInDbDuringHandler = row !== undefined;
    });
    bus.appendSessionEvent({ sessionId, type: "session.created" });
    unsubscribe();
    expect(sawRowInDbDuringHandler).toBe(true);
  });

  it("a late subscriber replaying via getSessionEventsAfter sees the identical sequence a live subscriber saw", () => {
    const liveEvents: bus.SessionEvent[] = [];
    const unsubscribe = bus.subscribeToSession(sessionId, (e) => liveEvents.push(e));

    bus.appendSessionEvent({ sessionId, type: "session.created" });
    bus.appendSessionEvent({ sessionId, type: "agent.spawned", payload: { role: "coder" } });
    bus.appendSessionEvent({ sessionId, type: "task.started", payload: { title: "t1" } });
    unsubscribe();

    const replayed = bus.getSessionEventsAfter(sessionId, 0);
    expect(replayed.map((e) => e.type)).toEqual(liveEvents.map((e) => e.type));
    expect(replayed.map((e) => e.payload)).toEqual(liveEvents.map((e) => e.payload));
    expect(replayed.map((e) => e.id)).toEqual(liveEvents.map((e) => e.id));
  });

  it("replay after a given cursor returns only what's strictly after it", () => {
    const e1 = bus.appendSessionEvent({ sessionId, type: "session.created" });
    const e2 = bus.appendSessionEvent({ sessionId, type: "task.started" });
    bus.appendSessionEvent({ sessionId, type: "task.completed" });

    expect(bus.getSessionEventsAfter(sessionId, e1.id).map((e) => e.type)).toEqual(["task.started", "task.completed"]);
    expect(bus.getSessionEventsAfter(sessionId, e2.id).map((e) => e.type)).toEqual(["task.completed"]);
  });

  it("zero live subscribers never drops an event — it keeps accumulating durably regardless", () => {
    // No subscriber attached at all for this test.
    bus.appendSessionEvent({ sessionId, type: "session.created" });
    bus.appendSessionEvent({ sessionId, type: "task.started" });

    expect(bus.getSessionEventsAfter(sessionId, 0)).toHaveLength(2);
  });

  it("killing the one live subscriber mid-session does not stop events from continuing to accumulate", () => {
    const received: bus.SessionEvent[] = [];
    const unsubscribe = bus.subscribeToSession(sessionId, (e) => received.push(e));
    bus.appendSessionEvent({ sessionId, type: "session.created" });
    unsubscribe(); // the one subscriber is gone

    bus.appendSessionEvent({ sessionId, type: "task.started" });
    bus.appendSessionEvent({ sessionId, type: "task.completed" });

    expect(received).toHaveLength(1); // only saw the first, live
    expect(bus.getSessionEventsAfter(sessionId, 0)).toHaveLength(3); // but all three are durably there
  });

  it("does not leak events or live notifications across sessions", () => {
    const otherSessionId = sessionStore.createSession({ userId, objective: "other" }).id;
    const receivedForOther: bus.SessionEvent[] = [];
    const unsubscribe = bus.subscribeToSession(otherSessionId, (e) => receivedForOther.push(e));

    bus.appendSessionEvent({ sessionId, type: "session.created" });
    unsubscribe();

    expect(receivedForOther).toHaveLength(0);
    expect(bus.getSessionEventsAfter(otherSessionId, 0)).toHaveLength(0);
  });

  it("carries agentId/taskId through when provided, null when not", () => {
    // agent_session_events.agent_id/task_id are real FKs (foreign_keys pragma is ON) — needs real
    // rows, same as agentSessionStore.test.ts's makeAgent() helper for the same reason.
    const agentId = randomUUID();
    db.prepare("INSERT INTO agents (id, session_id, role, display_name) VALUES (?, ?, 'coder', 'Test Agent')").run(
      agentId,
      sessionId
    );
    const task = sessionStore.createTask({ sessionId, title: "t" });

    const withScope = bus.appendSessionEvent({
      sessionId,
      agentId,
      taskId: task.id,
      type: "task.progress",
    });
    const sessionLevel = bus.appendSessionEvent({ sessionId, type: "checkpoint.started" });

    expect(withScope.agentId).toBe(agentId);
    expect(withScope.taskId).toBe(task.id);
    expect(sessionLevel.agentId).toBeNull();
    expect(sessionLevel.taskId).toBeNull();
  });
});
