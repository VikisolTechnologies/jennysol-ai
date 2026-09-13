// Phase 3 of docs/AI_AGENT_IMPLEMENTATION_PLAN.md: agent_tasks dependency resolution.
//
// Design decision (documented here per this phase's own requirement, not deferred silently):
// "ready" is a COMPUTED label, never a value written into agent_tasks.status. readyTasks() is a
// pure, read-only projection over whatever is currently persisted ('pending' tasks whose every
// dependency is 'completed') — nothing transitions a row to 'ready' in the DB. The Scheduler
// (Phase 6) calls readyTasks() each tick and, only once it actually grants an execution slot, writes
// 'queued' directly. This keeps readyTasks() genuinely side-effect-free, as this phase's own build
// note requires, and avoids a persisted status that would immediately go stale the instant another
// task completes.
//
// A task with a 'failed' or 'cancelled' dependency is never returned by readyTasks() and has no
// automatic unblock — it stays 'pending' indefinitely until something else acts on it. Reopening it
// is the Phase 11/12 correction-task mechanism's job (a real agent_tasks row targeting the failure),
// not this module's — recorded now so this isn't a silent gap.
//
// Cycle detection: since agent_tasks.id is always server-generated at insert time and depends_on can
// only reference ids that already exist, a SINGLE new task can structurally never complete a cycle —
// it can only add a new sink to an already-valid DAG. A genuine cycle risk exists only when several
// tasks reference each other by not-yet-persisted ids in one batch (e.g. an Orchestrator decomposing
// an objective into TASK-004..TASK-012 in one shot) — createTaskBatch() is where real cycle
// detection (Kahn's algorithm over the batch's local ids) lives; createTask() only needs a
// self-dependency check and an existence check against already-persisted tasks.
import * as sessionStore from "./agentSessionStore.js";
import type { AgentTask } from "./agentSessionStore.js";

export class TaskDagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskDagError";
  }
}

export function createTask(
  sessionId: string,
  params: { title: string; description?: string; dependsOn?: string[]; priority?: number }
): AgentTask {
  const dependsOn = params.dependsOn ?? [];
  for (const depId of dependsOn) {
    if (!sessionStore.getTask(sessionId, depId)) {
      throw new TaskDagError(`Task "${params.title}" depends on unknown task id "${depId}"`);
    }
  }
  return sessionStore.createTask({ sessionId, ...params });
}

export interface TaskDraft {
  // Caller-assigned label used only to wire up dependencies within this same batch (e.g. "TASK-006")
  // — never persisted; the real, server-generated agent_tasks.id replaces it once inserted.
  localId: string;
  title: string;
  description?: string;
  // May reference either another draft's localId in this same batch, or an already-persisted real
  // agent_tasks.id from an earlier batch/phase.
  dependsOn?: string[];
  priority?: number;
}

// Inserts a whole batch of interdependent tasks atomically: either every draft is valid (no
// self-dependency, no reference to an unknown id, no cycle among the batch's own local ids) and all
// are inserted in a topological order that guarantees a dependency's real id always exists before
// the task referencing it is created — or none are inserted at all.
export function createTaskBatch(sessionId: string, drafts: TaskDraft[]): AgentTask[] {
  const byLocalId = new Map<string, TaskDraft>();
  for (const draft of drafts) {
    if (byLocalId.has(draft.localId)) {
      throw new TaskDagError(`Duplicate localId "${draft.localId}" in task batch`);
    }
    byLocalId.set(draft.localId, draft);
  }

  for (const draft of drafts) {
    for (const dep of draft.dependsOn ?? []) {
      if (dep === draft.localId) {
        throw new TaskDagError(`Task "${draft.localId}" cannot depend on itself`);
      }
      if (!byLocalId.has(dep) && !sessionStore.getTask(sessionId, dep)) {
        throw new TaskDagError(`Task "${draft.localId}" depends on unknown task id "${dep}"`);
      }
    }
  }

  // Kahn's algorithm restricted to edges between two drafts IN this batch — an edge to an
  // already-persisted id is always "satisfied" (that task already exists, can't be part of a new
  // cycle) and is excluded from the in-degree count entirely.
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>(); // localId -> drafts that depend on it
  for (const draft of drafts) {
    inDegree.set(draft.localId, 0);
    dependents.set(draft.localId, []);
  }
  for (const draft of drafts) {
    for (const dep of draft.dependsOn ?? []) {
      if (byLocalId.has(dep)) {
        inDegree.set(draft.localId, (inDegree.get(draft.localId) ?? 0) + 1);
        dependents.get(dep)!.push(draft.localId);
      }
    }
  }

  const queue: string[] = [...inDegree.entries()].filter(([, deg]) => deg === 0).map(([id]) => id);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const dependent of dependents.get(id) ?? []) {
      const next = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, next);
      if (next === 0) queue.push(dependent);
    }
  }

  if (order.length !== drafts.length) {
    const cyclic = drafts.map((d) => d.localId).filter((id) => !order.includes(id));
    throw new TaskDagError(`Cycle detected among tasks: ${cyclic.join(", ")} — batch rejected, nothing inserted`);
  }

  const realIdByLocalId = new Map<string, string>();
  const created: AgentTask[] = [];
  for (const localId of order) {
    const draft = byLocalId.get(localId)!;
    const resolvedDeps = (draft.dependsOn ?? []).map((dep) => realIdByLocalId.get(dep) ?? dep);
    const task = sessionStore.createTask({
      sessionId,
      title: draft.title,
      description: draft.description,
      dependsOn: resolvedDeps,
      priority: draft.priority,
    });
    realIdByLocalId.set(localId, task.id);
    created.push(task);
  }
  return created;
}

// Pure, read-only projection — see the module-level comment for why 'ready' is never persisted.
// A task qualifies only while it's still 'pending' and every one of its dependencies is
// 'completed'; a dependency that is 'failed' or 'cancelled' permanently excludes it (until some
// later corrective mechanism changes the picture), a dependency still 'pending'/'running'/etc.
// excludes it for now.
export function readyTasks(sessionId: string): AgentTask[] {
  const all = sessionStore.listTasksForSession(sessionId);
  const statusById = new Map(all.map((t) => [t.id, t.status]));
  return all.filter((task) => {
    if (task.status !== "pending") return false;
    return task.dependsOn.every((depId) => statusById.get(depId) === "completed");
  });
}
