// Agent Runtime (JENNYSOL-ARCHITECTURE.md §3) — proves the persistence/observability/stop layer
// wraps the EXISTING tool-calling mechanism correctly, against real ToolRegistry connectors
// ("jennysol" and "arena", both really registered — see registryInstance.ts), with only
// routeChatCompletion mocked (same pattern agentGateway.http.test.ts already establishes).
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../modelRouter.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../modelRouter.js")>();
  return { ...actual, routeChatCompletion: vi.fn() };
});

import { routeChatCompletion } from "../modelRouter.js";
import { startRun, stopRun, getRun, resumeAfterApproval } from "./runtime.js";
import { __clearAllRunsForTests, __findRunByGoalForTests } from "./store.js";
import { __clearAllPendingActionsForTests } from "../tools/pendingActions.js";
import { toolRegistry } from "../tools/registryInstance.js";
import { DEFAULT_BUDGET } from "./types.js";
import type { ProductIdentity } from "../productIdentity.js";
import type { ToolCallHandler } from "../llmProvider.js";

const jennysolIdentity: ProductIdentity = { product: "jennysol", externalUserId: "u1", scope: ["jennysol.currentDateTime", "jennysol.getWeather"] };
const arenaIdentity: ProductIdentity = { product: "arena", externalUserId: "arena-u1", scope: ["arena.joinActivity"] };

function mockRoute(run: (onDelta: (t: string) => void, onToolCall: ToolCallHandler | undefined) => Promise<void>) {
  vi.mocked(routeChatCompletion).mockImplementation(async (_sys, _hist, onDelta, _sources, _cap, _sig, tools, onToolCall) => {
    if (!tools) {
      onDelta("Done from the observation.");
      return { providerUsed: "gemini", fellBack: false };
    }
    await run(onDelta, onToolCall);
    return { providerUsed: "gemini", fellBack: false };
  });
}

beforeEach(() => {
  vi.mocked(routeChatCompletion).mockReset();
  __clearAllRunsForTests();
  __clearAllPendingActionsForTests();
});

describe("agentRuntime.startRun — basic lifecycle", () => {
  it("completes a run that never calls a tool", async () => {
    mockRoute(async (onDelta) => onDelta("Here's the answer."));

    const run = await startRun(jennysolIdentity, "What's a good recipe for butter chicken?");

    expect(run.status).toBe("completed");
    expect(run.stopReason).toBe("completed");
    expect(run.content).toBe("Here's the answer.");
  });

  it("only offers the identity's OWN product's tools to the model — never another product's", async () => {
    let toolsSeen: Array<{ name: string }> = [];
    vi.mocked(routeChatCompletion).mockImplementation(async (_sys, _hist, onDelta, _sources, _cap, _sig, tools) => {
      toolsSeen = tools ?? [];
      onDelta("ok");
      return { providerUsed: "gemini", fellBack: false };
    });

    await startRun(jennysolIdentity, "what time is it");
    expect(toolsSeen.map((t) => t.name).every((n) => n.startsWith("jennysol."))).toBe(true);
    expect(toolsSeen.map((t) => t.name)).not.toContain("arena.joinActivity");

    await startRun(arenaIdentity, "join the game");
    expect(toolsSeen.map((t) => t.name).every((n) => n.startsWith("arena."))).toBe(true);
  });

  it("a READ tool call is dispatched immediately and recorded as a step", async () => {
    mockRoute(async (onDelta, onToolCall) => {
      const result = await onToolCall!({ id: "1", name: "jennysol.currentDateTime", args: { timezone: "UTC" } });
      onDelta(`It's ${JSON.stringify(result)}`);
    });

    const run = await startRun(jennysolIdentity, "what time is it");

    expect(run.status).toBe("completed");
    expect(run.content).toBe("Done from the observation.");
    const { steps } = getRun(run.id, jennysolIdentity)!;
    expect(steps).toHaveLength(3); // the tool call, the re-plan, then the final_answer marker
    expect(steps[0]).toMatchObject({ kind: "tool_call", toolName: "jennysol.currentDateTime", index: 0 });
    expect(steps[0].result).toBeDefined();
    expect(steps[0].endedAt).not.toBeNull();
    expect(steps[1]).toMatchObject({ kind: "final_answer", index: 1 });
  });

  it("a WRITE tool call pauses the run at awaiting_approval, using the SAME pendingActions store the gateway route uses", async () => {
    mockRoute(async (onDelta, onToolCall) => {
      const result = (await onToolCall!({ id: "1", name: "arena.joinActivity", args: { postId: "p1" } })) as { actionId: string };
      onDelta(`Set up — awaiting your approval (${result.actionId}).`);
    });

    const run = await startRun(arenaIdentity, "join the badminton game");

    expect(run.status).toBe("awaiting_approval");
    expect(run.stopReason).toBeUndefined();
    expect(typeof run.pendingActionId).toBe("string");
    // Re-fetched by id proves it's really persisted, not just the in-memory return value.
    const refetched = getRun(run.id, arenaIdentity)!;
    expect(refetched.run.status).toBe("awaiting_approval");
    expect(refetched.run.pendingActionId).toBe(run.pendingActionId);
  });

  it("stops calling tools once the step budget is spent, and marks the run failed/budget_exceeded", async () => {
    let calls = 0;
    mockRoute(async (onDelta, onToolCall) => {
      // A "runaway" plan that would call the tool forever if nothing stopped it.
      for (let i = 0; i < 20; i++) {
        calls++;
        await onToolCall!({ id: String(i), name: "jennysol.currentDateTime", args: {} });
      }
      onDelta("done");
    });

    const run = await startRun(jennysolIdentity, "loop forever", { maxSteps: 3, maxMs: 60_000 });

    expect(run.status).toBe("failed");
    expect(run.stopReason).toBe("budget_exceeded");
    // Exactly maxSteps tool calls actually completed before the guard threw on the next attempt.
    expect(calls).toBe(4); // 3 succeed, the 4th throws before doing anything
    const { steps } = getRun(run.id, jennysolIdentity)!;
    expect(steps.filter((s) => s.kind === "tool_call")).toHaveLength(3);
  });

  it("a real call to stopRun() aborts an in-flight run via the same AbortSignal the loop passes to routeChatCompletion", async () => {
    let releaseFirstStep: () => void = () => {};
    const firstStepGate = new Promise<void>((resolve) => {
      releaseFirstStep = resolve;
    });
    const goal = "a slow multi-step goal, stop me mid-flight";

    vi.mocked(routeChatCompletion).mockImplementation(async (_sys, _hist, onDelta, _sources, _cap, signal, _tools, onToolCall) => {
      await onToolCall!({ id: "1", name: "jennysol.currentDateTime", args: {} });
      await firstStepGate; // held open until the test calls the REAL stopRun()
      // A real provider checks its own signal and throws on abort — this is that check, not a
      // shortcut standing in for it.
      if (signal?.aborted) throw new Error("The operation was aborted");
      onDelta("finished normally"); // only reachable if stopRun() was NOT actually called
      return { providerUsed: "gemini", fellBack: false };
    });

    const runPromise = startRun(jennysolIdentity, goal);

    // Poll for the row the loop has already inserted — startRun() itself hasn't resolved yet.
    let midFlight: ReturnType<typeof __findRunByGoalForTests>;
    for (let i = 0; i < 50 && !midFlight; i++) {
      midFlight = __findRunByGoalForTests(goal);
      if (!midFlight) await new Promise((r) => setTimeout(r, 5));
    }
    expect(midFlight?.status).toBe("running");

    const stopped = stopRun(midFlight!.id, jennysolIdentity);
    expect(stopped.status).toBe("cancelled");

    releaseFirstStep();
    const finalRun = await runPromise;

    expect(finalRun.status).toBe("cancelled");
    expect(finalRun.stopReason).toBe("cancelled_by_user");
    expect(finalRun.content).not.toBe("finished normally"); // proves the abort really fired first
  });

  it("stopRun on an identity that doesn't own the run refuses, never a cross-identity stop", async () => {
    mockRoute(async (onDelta) => onDelta("ok"));
    const run = await startRun(jennysolIdentity, "hello");

    expect(() => stopRun(run.id, arenaIdentity)).toThrow(/No such run/);
    // The real owner can still stop/inspect it afterward.
    expect(getRun(run.id, jennysolIdentity)?.run.status).toBe("completed");
  });

  it("getRun returns undefined for a run id that belongs to a different identity", async () => {
    mockRoute(async (onDelta) => onDelta("ok"));
    const run = await startRun(jennysolIdentity, "hello");
    expect(getRun(run.id, arenaIdentity)).toBeUndefined();
  });

  // Independent review finding #1: a WRITE tool needing the caller's own product to authenticate
  // it (same reasoning as ToolExecutionContext) must actually receive the real token, not a
  // hardcoded "".
  it("forwards a real rawToken through to a dispatched tool, not a hardcoded empty string", async () => {
    let capturedToken: string | undefined;
    mockRoute(async (onDelta, onToolCall) => {
      await onToolCall!({ id: "1", name: "jennysol.getWeather", args: { location: "Hyderabad" } });
      onDelta("ok");
    });
    // jennysol.getWeather doesn't itself read rawToken, so assert via a spy on dispatch instead of
    // a real network call.
    const dispatchSpy = vi.spyOn(toolRegistry, "dispatch").mockImplementation(async (_id, _name, _args, ctx) => {
      capturedToken = ctx.rawToken;
      return { ok: true };
    });
    await startRun(jennysolIdentity, "what's the weather", DEFAULT_BUDGET, "real-user-token-abc");
    expect(capturedToken).toBe("real-user-token-abc");
    dispatchSpy.mockRestore();
  });

  // Independent review finding #2: a run must never carry two live, independently-approvable
  // proposals from proposing twice before the first is decided.
  it("refuses a second WRITE proposal while a run is already awaiting approval on the first", async () => {
    let secondCallResult: unknown;
    mockRoute(async (onDelta, onToolCall) => {
      const first = await onToolCall!({ id: "1", name: "arena.joinActivity", args: { postId: "p1" } });
      secondCallResult = await onToolCall!({ id: "2", name: "arena.joinActivity", args: { postId: "p2" } });
      onDelta(`first=${JSON.stringify(first)}`);
    });

    const run = await startRun(arenaIdentity, "join two activities");

    expect(run.status).toBe("awaiting_approval");
    const firstActionId = run.pendingActionId;
    expect(typeof firstActionId).toBe("string");
    // The SECOND call was refused, reported to the model as a tool error (never thrown out of
    // startRun itself) — the run stays paused on the FIRST proposal, not silently replaced by a
    // second one.
    expect(secondCallResult).toMatchObject({ error: expect.stringContaining("already waiting on your approval") });
    expect(run.pendingActionId).toBe(firstActionId);
    const { steps } = getRun(run.id, arenaIdentity)!;
    const toolSteps = steps.filter((s) => s.kind === "tool_call");
    expect(toolSteps).toHaveLength(2);
    expect(toolSteps[1].error).toContain("already waiting on your approval");
  });

  it("a provider failure ends that run and the next run still completes", async () => {
    vi.mocked(routeChatCompletion).mockRejectedValueOnce(new Error("provider down"));
    const failed = await startRun(jennysolIdentity, "this one fails");
    expect(failed.status).toBe("failed");
    expect(failed.stopReason).toBe("provider_failed");

    mockRoute(async (onDelta) => onDelta("recovered"));
    const next = await startRun(jennysolIdentity, "this one works");
    expect(next.status).toBe("completed");
    expect(next.content).toBe("recovered");
  });
});

// docs/reviews/d27386b.md STEP 4.1: a run paused at "awaiting_approval" previously had no way
// back — resumeAfterApproval is the second, session-authenticated entry point into the SAME
// pendingActions store/dispatch the gateway route already proves works.
describe("agentRuntime.resumeAfterApproval", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  async function pausedRun() {
    mockRoute(async (onDelta, onToolCall) => {
      const result = (await onToolCall!({ id: "1", name: "arena.joinActivity", args: { postId: "p1" } })) as { actionId: string };
      onDelta(`awaiting approval (${result.actionId})`);
    });
    return startRun(arenaIdentity, "join the badminton game");
  }

  it("approving resumes the run: dispatches the real tool, then gives a final answer from the result", async () => {
    const paused = await pausedRun();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { status: "confirmed" } }),
    });
    vi.mocked(routeChatCompletion).mockImplementationOnce(async (_sys, _hist, onDelta) => {
      onDelta("You're in! Your spot is confirmed.");
      return { providerUsed: "gemini", fellBack: false };
    });

    const resumed = await resumeAfterApproval(paused.id, arenaIdentity, paused.pendingActionId!, true);

    expect(resumed.status).toBe("completed");
    expect(resumed.stopReason).toBe("completed");
    expect(resumed.content).toBe("You're in! Your spot is confirmed.");
    expect(resumed.pendingActionId).toBeUndefined();
    const { steps } = getRun(resumed.id, arenaIdentity)!;
    const toolSteps = steps.filter((s) => s.kind === "tool_call");
    expect(toolSteps).toHaveLength(2); // the original proposal step, then the post-approval execution
    expect(toolSteps[1].result).toMatchObject({ requested: true, status: "confirmed" });
    expect(toolSteps[1].endedAt).not.toBeNull();
  });

  it("rejecting cancels the run without ever dispatching the tool", async () => {
    const paused = await pausedRun();
    const resumed = await resumeAfterApproval(paused.id, arenaIdentity, paused.pendingActionId!, false);

    expect(resumed.status).toBe("cancelled");
    expect(resumed.stopReason).toBe("rejected_by_user");
    expect(resumed.pendingActionId).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a real tool failure after approval still ends the run with an honest answer, not a crash", async () => {
    const paused = await pausedRun();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ success: false, message: "Activity is full" }) });
    vi.mocked(routeChatCompletion).mockImplementationOnce(async (_sys, _hist, onDelta) => {
      onDelta("That activity filled up before your spot was confirmed.");
      return { providerUsed: "gemini", fellBack: false };
    });

    const resumed = await resumeAfterApproval(paused.id, arenaIdentity, paused.pendingActionId!, true);

    expect(resumed.status).toBe("completed");
    expect(resumed.content).toBe("That activity filled up before your spot was confirmed.");
    const { steps } = getRun(resumed.id, arenaIdentity)!;
    const toolSteps = steps.filter((s) => s.kind === "tool_call");
    expect(toolSteps[1].error).toContain("Activity is full");
  });

  it("refuses a mismatched actionId rather than resolving whatever the run happens to be holding", async () => {
    const paused = await pausedRun();
    await expect(resumeAfterApproval(paused.id, arenaIdentity, "some-other-action-id", true)).rejects.toThrow(
      /no longer matches/
    );
    // The real pending action is untouched — still resolvable with its real id.
    const stillPaused = getRun(paused.id, arenaIdentity)!;
    expect(stillPaused.run.status).toBe("awaiting_approval");
    expect(stillPaused.run.pendingActionId).toBe(paused.pendingActionId);
  });

  it("refuses to resume a run that isn't actually awaiting approval", async () => {
    mockRoute(async (onDelta) => onDelta("already done"));
    const completed = await startRun(jennysolIdentity, "hello");
    await expect(resumeAfterApproval(completed.id, jennysolIdentity, "whatever", true)).rejects.toThrow(
      /no pending approval/
    );
  });

  it("refuses to resume a run owned by a different identity", async () => {
    const paused = await pausedRun();
    await expect(resumeAfterApproval(paused.id, jennysolIdentity, paused.pendingActionId!, true)).rejects.toThrow(
      /No such run/
    );
  });

  it("approving twice fails the second time — single-use, same as the gateway route", async () => {
    const paused = await pausedRun();
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, data: { status: "confirmed" } }) });
    vi.mocked(routeChatCompletion).mockImplementationOnce(async (_sys, _hist, onDelta) => {
      onDelta("confirmed");
      return { providerUsed: "gemini", fellBack: false };
    });
    await resumeAfterApproval(paused.id, arenaIdentity, paused.pendingActionId!, true);

    await expect(resumeAfterApproval(paused.id, arenaIdentity, paused.pendingActionId!, true)).rejects.toThrow(
      /no pending approval/
    );
  });
});
