import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import * as sessionStore from "./agentSessionStore.js";
import * as dag from "./agentTaskDag.js";

function makeUser() {
  const userId = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, 'x', 'Test User')").run(
    userId,
    `${userId}@example.test`
  );
  return userId;
}

describe("agentTaskDag", () => {
  let userId: string;
  let sessionId: string;

  beforeEach(() => {
    userId = makeUser();
    sessionId = sessionStore.createSession({ userId, objective: "test" }).id;
  });

  afterEach(() => {
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  });

  describe("createTask (single)", () => {
    it("rejects a dependency on an id that doesn't exist yet", () => {
      expect(() => dag.createTask(sessionId, { title: "x", dependsOn: [randomUUID()] })).toThrow(dag.TaskDagError);
    });

    it("accepts a dependency on an already-persisted task", () => {
      const t1 = dag.createTask(sessionId, { title: "first" });
      const t2 = dag.createTask(sessionId, { title: "second", dependsOn: [t1.id] });
      expect(t2.dependsOn).toEqual([t1.id]);
    });
  });

  describe("createTaskBatch — the founding directive's own §9 worked example", () => {
    it("TASK-006 depends on TASK-004+TASK-005; TASK-012 depends on six upstream tasks — all insert correctly", () => {
      const created = dag.createTaskBatch(sessionId, [
        { localId: "TASK-001", title: "Task 1" },
        { localId: "TASK-002", title: "Task 2" },
        { localId: "TASK-003", title: "Task 3" },
        { localId: "TASK-004", title: "Task 4" },
        { localId: "TASK-005", title: "Task 5" },
        { localId: "TASK-006", title: "Task 6", dependsOn: ["TASK-004", "TASK-005"] },
        { localId: "TASK-007", title: "Task 7" },
        {
          localId: "TASK-012",
          title: "Task 12",
          dependsOn: ["TASK-001", "TASK-002", "TASK-003", "TASK-004", "TASK-005", "TASK-006"],
        },
      ]);

      const byLocal = (i: number) => created.find((t) => t.title === `Task ${i}`)!;
      const task6 = byLocal(6);
      const task4 = byLocal(4);
      const task5 = byLocal(5);
      expect(new Set(task6.dependsOn)).toEqual(new Set([task4.id, task5.id]));

      const task12 = byLocal(12);
      expect(task12.dependsOn).toHaveLength(6);
      expect(new Set(task12.dependsOn)).toEqual(
        new Set([1, 2, 3, 4, 5, 6].map((i) => byLocal(i).id))
      );

      // Real, resolvable ids — not the local labels — actually persisted.
      expect(sessionStore.getTask(sessionId, task12.id)!.dependsOn).toEqual(task12.dependsOn);
    });

    it("mixes a batch-local dependency with a reference to an already-persisted task from an earlier batch", () => {
      const earlier = dag.createTask(sessionId, { title: "earlier" });
      const [t1, t2] = dag.createTaskBatch(sessionId, [
        { localId: "A", title: "A", dependsOn: [earlier.id] },
        { localId: "B", title: "B", dependsOn: ["A"] },
      ]);
      expect(t1.dependsOn).toEqual([earlier.id]);
      expect(t2.dependsOn).toEqual([t1.id]);
    });
  });

  describe("cycle and self-dependency rejection", () => {
    it("rejects a task depending on itself, inserting nothing", () => {
      expect(() =>
        dag.createTaskBatch(sessionId, [{ localId: "A", title: "A", dependsOn: ["A"] }])
      ).toThrow(dag.TaskDagError);
      expect(sessionStore.listTasksForSession(sessionId)).toHaveLength(0);
    });

    it("rejects a genuine cycle (A -> B -> A), inserting neither task", () => {
      expect(() =>
        dag.createTaskBatch(sessionId, [
          { localId: "A", title: "A", dependsOn: ["B"] },
          { localId: "B", title: "B", dependsOn: ["A"] },
        ])
      ).toThrow(dag.TaskDagError);
      expect(sessionStore.listTasksForSession(sessionId)).toHaveLength(0);
    });

    it("rejects a longer cycle (A -> B -> C -> A) and leaves the session untouched", () => {
      expect(() =>
        dag.createTaskBatch(sessionId, [
          { localId: "A", title: "A", dependsOn: ["C"] },
          { localId: "B", title: "B", dependsOn: ["A"] },
          { localId: "C", title: "C", dependsOn: ["B"] },
        ])
      ).toThrow(dag.TaskDagError);
      expect(sessionStore.listTasksForSession(sessionId)).toHaveLength(0);
    });

    it("rejects a batch referencing an unknown id, inserting nothing from the whole batch", () => {
      expect(() =>
        dag.createTaskBatch(sessionId, [
          { localId: "A", title: "A" },
          { localId: "B", title: "B", dependsOn: ["does-not-exist"] },
        ])
      ).toThrow(dag.TaskDagError);
      expect(sessionStore.listTasksForSession(sessionId)).toHaveLength(0);
    });
  });

  describe("readyTasks", () => {
    it("is empty until dependencies actually complete", () => {
      const t1 = dag.createTask(sessionId, { title: "t1" });
      const t2 = dag.createTask(sessionId, { title: "t2", dependsOn: [t1.id] });

      expect(dag.readyTasks(sessionId).map((t) => t.id)).toEqual([t1.id]); // t1 has no deps: ready now

      sessionStore.updateTaskStatus(sessionId, t1.id, "completed");
      expect(dag.readyTasks(sessionId).map((t) => t.id)).toEqual([t2.id]);
    });

    it("requires ALL dependencies completed, not just one of several", () => {
      const t1 = dag.createTask(sessionId, { title: "t1" });
      const t2 = dag.createTask(sessionId, { title: "t2" });
      const t3 = dag.createTask(sessionId, { title: "t3", dependsOn: [t1.id, t2.id] });

      sessionStore.updateTaskStatus(sessionId, t1.id, "completed");
      expect(dag.readyTasks(sessionId).map((t) => t.id)).not.toContain(t3.id);

      sessionStore.updateTaskStatus(sessionId, t2.id, "completed");
      expect(dag.readyTasks(sessionId).map((t) => t.id)).toContain(t3.id);
    });

    it("never returns a task whose dependency failed — it stays blocked, not ready", () => {
      const t1 = dag.createTask(sessionId, { title: "t1" });
      const t2 = dag.createTask(sessionId, { title: "t2", dependsOn: [t1.id] });

      sessionStore.updateTaskStatus(sessionId, t1.id, "failed");
      expect(dag.readyTasks(sessionId).map((t) => t.id)).not.toContain(t2.id);
      expect(sessionStore.getTask(sessionId, t2.id)!.status).toBe("pending"); // still pending, not auto-failed either
    });

    it("never returns a task that isn't 'pending' even if its deps are satisfied (e.g. already running)", () => {
      const t1 = dag.createTask(sessionId, { title: "t1" });
      sessionStore.updateTaskStatus(sessionId, t1.id, "completed");
      const t2 = dag.createTask(sessionId, { title: "t2", dependsOn: [t1.id] });
      sessionStore.updateTaskStatus(sessionId, t2.id, "running");

      expect(dag.readyTasks(sessionId).map((t) => t.id)).not.toContain(t2.id);
    });

    it("does not leak readiness across sessions", () => {
      const other = sessionStore.createSession({ userId, objective: "other" }).id;
      dag.createTask(sessionId, { title: "only in this session" });
      expect(dag.readyTasks(other)).toHaveLength(0);
    });
  });
});
