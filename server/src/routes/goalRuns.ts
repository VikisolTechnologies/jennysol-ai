import { Router } from "express";
import type { ProductIdentity } from "../services/productIdentity.js";
import { getRun, startRun, stopRun } from "../services/agentRuntime/runtime.js";
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
