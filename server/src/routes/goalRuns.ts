import { Router } from "express";
import type { ProductIdentity } from "../services/productIdentity.js";
import { getRun, startRun, stopRun, resumeAfterApproval } from "../services/agentRuntime/runtime.js";
import { listOwnedRuns } from "../services/agentRuntime/store.js";
import { AgentGoalRunError } from "../services/agentRuntime/types.js";

export const goalRunsRouter = Router();

function identityFor(userId: string): ProductIdentity {
  return {
    product: "jennysol",
    externalUserId: userId,
    scope: ["jennysol.currentDateTime", "jennysol.getWeather", "jennysol.webSearch"],
  };
}

goalRunsRouter.get("/", (req, res) => {
  const identity = identityFor(req.userId!);
  const runs = listOwnedRuns(identity).map((run) => ({
    run,
    steps: getRun(run.id, identity)?.steps ?? [],
  }));
  res.json({ runs });
});

goalRunsRouter.post("/", async (req, res) => {
  const goal = typeof req.body?.goal === "string" ? req.body.goal.trim() : "";
  if (!goal) {
    res.status(400).json({ error: "A goal is required" });
    return;
  }
  try {
    const identity = identityFor(req.userId!);
    const run = await startRun(identity, goal, undefined, req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
    res.status(201).json({ run, steps: getRun(run.id, identity)?.steps ?? [] });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "The run failed" });
  }
});

const decisionSchema = { approve: (v: unknown) => typeof v === "boolean" };

goalRunsRouter.post("/:id/actions/:actionId", async (req, res) => {
  if (!decisionSchema.approve(req.body?.approve)) {
    res.status(400).json({ error: "approve must be a boolean" });
    return;
  }
  try {
    const identity = identityFor(req.userId!);
    const run = await resumeAfterApproval(
      req.params.id,
      identity,
      req.params.actionId,
      req.body.approve,
      req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? ""
    );
    res.json({ run, steps: getRun(run.id, identity)?.steps ?? [] });
  } catch (err) {
    if (err instanceof AgentGoalRunError) {
      res.status(409).json({ error: err.message });
      return;
    }
    res.status(502).json({ error: err instanceof Error ? err.message : "Couldn't resolve that action" });
  }
});

goalRunsRouter.post("/:id/stop", (req, res) => {
  try {
    const run = stopRun(req.params.id, identityFor(req.userId!));
    res.json({ run });
  } catch (err) {
    if (err instanceof AgentGoalRunError) {
      res.status(404).json({ error: err.message });
      return;
    }
    throw err;
  }
});
