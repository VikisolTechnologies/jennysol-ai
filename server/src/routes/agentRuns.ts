import { Router } from "express";
import { getRun, getEventsAfter, listActiveOrUnseenRuns, markSeen } from "../services/agentRunStore.js";
import { cancelRun } from "../services/runCancellation.js";

export const agentRunsRouter = Router();

// Powers "Jenny finished while you were away" / reconnect-on-load: every run
// that's still in flight, or that finished since the client last marked it
// seen. Must be registered before "/:id" below or Express would try to
// resolve "active" as a run id.
agentRunsRouter.get("/active", (req, res) => {
  res.json({ runs: listActiveOrUnseenRuns(req.userId!) });
});

agentRunsRouter.get("/:id", (req, res) => {
  const run = getRun(req.userId!, req.params.id);
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  res.json({ run });
});

// Event replay: a client that saw events up through a given id (e.g. the
// last message.delta it rendered before its connection dropped) asks for
// everything after that instead of re-deriving state or missing a gap.
agentRunsRouter.get("/:id/events", (req, res) => {
  const run = getRun(req.userId!, req.params.id);
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  const after = Number(req.query.after) || 0;
  res.json({ events: getEventsAfter(req.params.id, after) });
});

agentRunsRouter.post("/:id/seen", (req, res) => {
  const run = getRun(req.userId!, req.params.id);
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  markSeen(req.userId!, req.params.id);
  res.status(204).send();
});

// Run-scoped cancellation (see runCancellation.ts) — ownership is checked
// via getRun(userId, id) exactly like every other route here, so cancelling
// requires the run actually being yours; cancelRun() itself only ever
// touches this one runId's own controller, never any other run's.
agentRunsRouter.post("/:id/cancel", (req, res) => {
  const run = getRun(req.userId!, req.params.id);
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
    res.status(409).json({ error: "Run has already finished", status: run.status });
    return;
  }
  const cancelled = cancelRun(req.params.id);
  res.json({ cancelled });
});
