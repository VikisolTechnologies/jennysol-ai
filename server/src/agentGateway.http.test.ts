// M6 (agent gateway) — real HTTP-layer tests against the actual configured Express app (app.ts),
// matching httpRoutes.test.ts's own pattern: through the real middleware chain
// (requireProductIdentity, zod validation), not a direct function call. Closes the gap this
// milestone's own commit flagged (manually curl-verified against a live local server, not yet an
// automated regression test) now that this repository has real supertest infrastructure to do it
// properly, added concurrently by another session's own work this same day.

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("./services/modelRouter.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./services/modelRouter.js")>();
  return { ...actual, routeChatCompletion: vi.fn() };
});

import jwt from "jsonwebtoken";
import { app } from "./app.js";
import { routeChatCompletion } from "./services/modelRouter.js";
import { signServiceToken } from "./services/serviceToken.js";
import { ACTION_TTL_MS } from "./services/tools/pendingActions.js";

const ARENA_SECRET = "arena-test-secret-do-not-use-in-production";
const WRONG_SECRET = "not-arenas-real-secret-do-not-use-in-production";

describe("POST /api/agent/gateway/chat (M6, real HTTP)", () => {
  beforeEach(() => {
    vi.mocked(routeChatCompletion).mockReset();
    process.env.SERVICE_TOKEN_SECRET_ARENA = ARENA_SECRET;
  });

  it("rejects a request with no Authorization header", async () => {
    await request(app).post("/api/agent/gateway/chat").send({ message: "hi" }).expect(401);
    expect(routeChatCompletion).not.toHaveBeenCalled();
  });

  it("rejects a garbage bearer token", async () => {
    await request(app)
      .post("/api/agent/gateway/chat")
      .set("Authorization", "Bearer garbage")
      .send({ message: "hi" })
      .expect(401);
  });

  // Contract lock (JENNYSOL-FINISH-ALL.md STEP 1): a well-formed JWT that merely claims to be
  // Arena's, but is signed with a different key, must be rejected through the real HTTP route —
  // not just at the unit level (serviceToken.test.ts already covers the unit case; this is the
  // same attack proven through the actual Express app an attacker would hit).
  it("rejects a forged token — well-formed JWT claiming to be Arena's, signed with the wrong secret", async () => {
    const forged = jwt.sign(
      { role: "TALENT", scope: ["arena.searchJobs"] },
      WRONG_SECRET,
      { subject: "attacker", issuer: "arena", audience: "jennysol", expiresIn: 60, algorithm: "HS256" }
    );
    await request(app)
      .post("/api/agent/gateway/chat")
      .set("Authorization", `Bearer ${forged}`)
      .send({ message: "hi" })
      .expect(401);
    expect(routeChatCompletion).not.toHaveBeenCalled();
  });

  it("rejects a malformed request body (missing message) with 400, not a 500", async () => {
    const token = signServiceToken({ issuer: "arena", externalUserId: "u1", scope: [] });
    await request(app)
      .post("/api/agent/gateway/chat")
      .set("Authorization", `Bearer ${token}`)
      .send({})
      .expect(400);
    expect(routeChatCompletion).not.toHaveBeenCalled();
  });

  it("a valid Arena token with searchJobs scope reaches routeChatCompletion with arena.searchJobs offered", async () => {
    vi.mocked(routeChatCompletion).mockImplementation(async (_sys, _hist, onDelta) => {
      onDelta("Here's what I found.");
      return { providerUsed: "gemini", fellBack: false };
    });
    const token = signServiceToken({
      issuer: "arena",
      externalUserId: "arena-user-1",
      role: "TALENT",
      scope: ["arena.searchJobs"],
    });

    const res = await request(app)
      .post("/api/agent/gateway/chat")
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "find me React jobs" })
      .expect(200);

    expect(res.body).toEqual({ content: "Here's what I found." });
    expect(routeChatCompletion).toHaveBeenCalledTimes(1);
    const [, , , , , , toolsArg, onToolCallArg] = vi.mocked(routeChatCompletion).mock.calls[0];
    expect(toolsArg?.map((t) => t.name)).toEqual(["arena.searchJobs"]);
    expect(typeof onToolCallArg).toBe("function");
  });

  it("a valid Arena token with NO tool scope reaches routeChatCompletion with no tools offered", async () => {
    vi.mocked(routeChatCompletion).mockImplementation(async (_sys, _hist, onDelta) => {
      onDelta("Just a plain answer.");
      return { providerUsed: "gemini", fellBack: false };
    });
    const token = signServiceToken({ issuer: "arena", externalUserId: "arena-user-2", scope: [] });

    const res = await request(app)
      .post("/api/agent/gateway/chat")
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "hi" })
      .expect(200);

    expect(res.body).toEqual({ content: "Just a plain answer." });
    const [, , , , , , toolsArg, onToolCallArg] = vi.mocked(routeChatCompletion).mock.calls[0];
    expect(toolsArg).toBeUndefined();
    expect(onToolCallArg).toBeUndefined();
  });

  it("actually dispatches arena.searchJobs through the real ToolRegistry when the mocked model calls it", async () => {
    vi.mocked(routeChatCompletion).mockImplementation(async (_sys, _hist, onDelta, _sources, _cap, _sig, _tools, onToolCall) => {
      // Simulate the model deciding to call the tool — proves the gateway's onToolCall really
      // reaches the real ToolRegistry.dispatch (product/scope re-checked there independently),
      // not just that it was passed through unexamined.
      const result = await onToolCall!({ id: "1", name: "arena.searchJobs", args: { page: 0, size: 5 } });
      onDelta(`Tool returned: ${JSON.stringify(result)}`);
      return { providerUsed: "gemini", fellBack: false };
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { content: [] } }) })
    );
    const token = signServiceToken({
      issuer: "arena",
      externalUserId: "arena-user-3",
      scope: ["arena.searchJobs"],
    });

    const res = await request(app)
      .post("/api/agent/gateway/chat")
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "find me jobs" })
      .expect(200);

    // arena.searchJobs now returns a trimmed job list (the empty page -> []).
    expect(res.body.content).toContain("[]");
  });

  it("returns 502 with a clear message when the model router has nothing configured (real production-equivalent boundary)", async () => {
    const { AllProvidersUnavailableError } = await vi.importActual<typeof import("./services/modelRouter.js")>(
      "./services/modelRouter.js"
    );
    vi.mocked(routeChatCompletion).mockRejectedValue(
      new AllProvidersUnavailableError([{ name: "gemini", reason: "not configured" }])
    );
    const token = signServiceToken({ issuer: "arena", externalUserId: "arena-user-4", scope: [] });

    const res = await request(app)
      .post("/api/agent/gateway/chat")
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "hi" })
      .expect(502);

    expect(res.body.error).toBeTruthy();
  });
});

// M7 (approval-controlled write tools) — the propose/approve/execute chain through real HTTP,
// same supertest-against-the-real-app pattern as the M6 block above. A WRITE tool's call must
// never dispatch immediately from /chat; it becomes a PendingAction surfaced in the response, and
// only POST /actions/:actionId (re-verifying the SAME identity) can execute or discard it.
describe("POST /api/agent/gateway/chat — WRITE tier tools & POST /api/agent/gateway/actions/:actionId (M7, real HTTP)", () => {
  beforeEach(() => {
    vi.mocked(routeChatCompletion).mockReset();
    process.env.SERVICE_TOKEN_SECRET_ARENA = ARENA_SECRET;
  });

  function talentToken(externalUserId: string) {
    return signServiceToken({
      issuer: "arena",
      externalUserId,
      role: "TALENT",
      scope: ["arena.applyToJob"],
    });
  }

  it("a WRITE tool call from the model never dispatches immediately — it comes back as a pendingAction", async () => {
    vi.mocked(routeChatCompletion).mockImplementation(async (_sys, _hist, onDelta, _sources, _cap, _sig, _tools, onToolCall) => {
      const result = await onToolCall!({ id: "1", name: "arena.applyToJob", args: { jobId: "job-42" } });
      onDelta(`Tool said: ${JSON.stringify(result)}`);
      return { providerUsed: "gemini", fellBack: false };
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const token = talentToken("arena-user-write-1");

    const res = await request(app)
      .post("/api/agent/gateway/chat")
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "Apply me to job-42" })
      .expect(200);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.body.content).toContain("awaiting_user_approval");
    expect(res.body.pendingActions).toHaveLength(1);
    expect(res.body.pendingActions[0]).toMatchObject({ toolName: "arena.applyToJob", args: { jobId: "job-42" } });
    expect(typeof res.body.pendingActions[0].actionId).toBe("string");
  });

  it("approving the proposed action's actionId actually dispatches the real tool exactly once", async () => {
    let capturedActionId = "";
    vi.mocked(routeChatCompletion).mockImplementation(async (_sys, _hist, onDelta, _sources, _cap, _sig, _tools, onToolCall) => {
      const result = (await onToolCall!({ id: "1", name: "arena.applyToJob", args: { jobId: "job-42" } })) as {
        actionId: string;
      };
      capturedActionId = result.actionId;
      onDelta("ok");
      return { providerUsed: "gemini", fellBack: false };
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { id: "app-1", jobId: "job-42" } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const token = talentToken("arena-user-write-2");

    await request(app)
      .post("/api/agent/gateway/chat")
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "Apply me to job-42" })
      .expect(200);

    const approveRes = await request(app)
      .post(`/api/agent/gateway/actions/${capturedActionId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ approve: true })
      .expect(200);

    expect(approveRes.body).toEqual({ status: "executed", result: expect.objectContaining({ applied: true, url: "https://arena.vikisol.in/jobs/job-42" }) });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/applications"),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${token}` }) })
    );

    // Single-use: approving the same actionId again must fail rather than re-executing.
    await request(app)
      .post(`/api/agent/gateway/actions/${capturedActionId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ approve: true })
      .expect(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // Contract lock: the 5-minute expiry through the real HTTP route, not just pendingActions.test.ts's
  // direct-function-call coverage of the same rule.
  it("an action older than the 5-minute TTL is rejected as expired, with a 'code' the caller can branch on, and never dispatches", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      let capturedActionId = "";
      vi.mocked(routeChatCompletion).mockImplementation(async (_sys, _hist, onDelta, _sources, _cap, _sig, _tools, onToolCall) => {
        capturedActionId = ((await onToolCall!({ id: "1", name: "arena.applyToJob", args: { jobId: "job-stale" } })) as { actionId: string }).actionId;
        onDelta("ok");
        return { providerUsed: "gemini", fellBack: false };
      });
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const externalUserId = "arena-user-write-expiry";
      const token = talentToken(externalUserId);

      await request(app).post("/api/agent/gateway/chat").set("Authorization", `Bearer ${token}`).send({ message: "Apply me" }).expect(200);

      vi.advanceTimersByTime(ACTION_TTL_MS + 1000);

      // A fresh service token for the same user — real Arena mints one per request rather than
      // reusing an old one (see RealAgentServiceClient), so this isolates the pending ACTION's
      // own 5-minute TTL from the separate, much-shorter service-token TTL.
      const freshToken = talentToken(externalUserId);
      const res = await request(app)
        .post(`/api/agent/gateway/actions/${capturedActionId}`)
        .set("Authorization", `Bearer ${freshToken}`)
        .send({ approve: true })
        .expect(404);

      expect(res.body.code).toBe("expired");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejecting a proposed action discards it without ever calling the real tool", async () => {
    let capturedActionId = "";
    vi.mocked(routeChatCompletion).mockImplementation(async (_sys, _hist, onDelta, _sources, _cap, _sig, _tools, onToolCall) => {
      const result = (await onToolCall!({ id: "1", name: "arena.applyToJob", args: { jobId: "job-99" } })) as {
        actionId: string;
      };
      capturedActionId = result.actionId;
      onDelta("ok");
      return { providerUsed: "gemini", fellBack: false };
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const token = talentToken("arena-user-write-3");

    await request(app)
      .post("/api/agent/gateway/chat")
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "Apply me to job-99" })
      .expect(200);

    const rejectRes = await request(app)
      .post(`/api/agent/gateway/actions/${capturedActionId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ approve: false })
      .expect(200);

    expect(rejectRes.body).toEqual({ status: "rejected" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a different identity can never approve someone else's pending action", async () => {
    let capturedActionId = "";
    vi.mocked(routeChatCompletion).mockImplementation(async (_sys, _hist, onDelta, _sources, _cap, _sig, _tools, onToolCall) => {
      const result = (await onToolCall!({ id: "1", name: "arena.applyToJob", args: { jobId: "job-7" } })) as {
        actionId: string;
      };
      capturedActionId = result.actionId;
      onDelta("ok");
      return { providerUsed: "gemini", fellBack: false };
    });
    vi.stubGlobal("fetch", vi.fn());
    const ownerToken = talentToken("arena-user-owner");
    const intruderToken = talentToken("arena-user-intruder");

    await request(app)
      .post("/api/agent/gateway/chat")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ message: "Apply me to job-7" })
      .expect(200);

    await request(app)
      .post(`/api/agent/gateway/actions/${capturedActionId}`)
      .set("Authorization", `Bearer ${intruderToken}`)
      .send({ approve: true })
      .expect(404);
  });

  async function proposeApply(token: string, jobId: string): Promise<string> {
    let actionId = "";
    vi.mocked(routeChatCompletion).mockImplementation(async (_sys, _hist, onDelta, _sources, _cap, _sig, _tools, onToolCall) => {
      actionId = ((await onToolCall!({ id: "1", name: "arena.applyToJob", args: { jobId } })) as { actionId: string }).actionId;
      onDelta("ok");
      return { providerUsed: "gemini", fellBack: false };
    });
    await request(app).post("/api/agent/gateway/chat").set("Authorization", `Bearer ${token}`).send({ message: `Apply me to ${jobId}` }).expect(200);
    return actionId;
  }

  it("reports a definite 'failed' (422) when Arena answers and refuses the action", async () => {
    const token = talentToken("arena-user-write-5");
    const actionId = await proposeApply(token, "job-closed");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 400, json: async () => ({ success: false, message: "This job is no longer accepting applications" }),
    }));
    const res = await request(app).post(`/api/agent/gateway/actions/${actionId}`).set("Authorization", `Bearer ${token}`).send({ approve: true }).expect(422);
    expect(res.body).toEqual({ status: "failed", error: "This job is no longer accepting applications" });
  });

  it("keeps a 5xx or network failure ambiguous (502), never 'failed'", async () => {
    const token = talentToken("arena-user-write-6");
    const first = await proposeApply(token, "job-5xx");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ success: false }) }));
    await request(app).post(`/api/agent/gateway/actions/${first}`).set("Authorization", `Bearer ${token}`).send({ approve: true }).expect(502);
    const second = await proposeApply(token, "job-timeout");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("The operation was aborted due to timeout")));
    await request(app).post(`/api/agent/gateway/actions/${second}`).set("Authorization", `Bearer ${token}`).send({ approve: true }).expect(502);
  });

  it("never returns a blank reply: empty text with a proposal gets a default line, without one it's a 502", async () => {
    const token = talentToken("arena-user-write-7");
    vi.mocked(routeChatCompletion).mockImplementation(async (_sys, _hist, _onDelta, _sources, _cap, _sig, _tools, onToolCall) => {
      await onToolCall!({ id: "1", name: "arena.applyToJob", args: { jobId: "job-1" } });
      return { providerUsed: "gemini", fellBack: false };
    });
    const withAction = await request(app).post("/api/agent/gateway/chat").set("Authorization", `Bearer ${token}`).send({ message: "Apply me" }).expect(200);
    expect(withAction.body.content).toMatch(/review the details/);
    expect(withAction.body.pendingActions).toHaveLength(1);

    vi.mocked(routeChatCompletion).mockImplementation(async (_sys, _hist, onDelta) => {
      onDelta("   ");
      return { providerUsed: "gemini", fellBack: false };
    });
    await request(app).post("/api/agent/gateway/chat").set("Authorization", `Bearer ${token}`).send({ message: "Hi" }).expect(502);
  });

  it("rejects an unknown actionId with 404", async () => {
    const token = talentToken("arena-user-write-4");
    await request(app)
      .post("/api/agent/gateway/actions/not-a-real-id")
      .set("Authorization", `Bearer ${token}`)
      .send({ approve: true })
      .expect(404);
  });

  it("rejects an actions request with no Authorization header", async () => {
    await request(app).post("/api/agent/gateway/actions/whatever").send({ approve: true }).expect(401);
  });
});

// Arena restructure Phase 3 (Jenny): the gateway carries the product's conversation history and
// user context, adds the product's own assistant instructions, and asks for a difficulty tier
// with Claude first when it's configured.
describe("POST /api/agent/gateway/chat - Jenny context (Phase 3)", () => {
  beforeEach(() => {
    vi.mocked(routeChatCompletion).mockReset();
    process.env.SERVICE_TOKEN_SECRET_ARENA = ARENA_SECRET;
  });

  it("passes history, user context, Jenny's instructions, the tier and a Claude-first chain", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    vi.mocked(routeChatCompletion).mockImplementation(async (_sys, _hist, onDelta) => {
      onDelta("ok");
      return { providerUsed: "anthropic", fellBack: false };
    });
    const token = signServiceToken({ issuer: "arena", externalUserId: "u-ctx", role: "TALENT", scope: ["arena.search"] });

    await request(app)
      .post("/api/agent/gateway/chat")
      .set("Authorization", `Bearer ${token}`)
      .send({
        message: "plan a basketball game this saturday and invite people",
        history: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "Hi! What would you like to do?" },
        ],
        context: "Name: Priya. Area: Gachibowli (17.44, 78.35).",
      })
      .expect(200);

    const args = vi.mocked(routeChatCompletion).mock.calls[0];
    const [systemPrompt, history] = args;
    expect(systemPrompt).toContain("Jenny");
    expect(systemPrompt).toContain("Area: Gachibowli");
    expect(history).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "Hi! What would you like to do?" },
      { role: "user", content: "plan a basketball game this saturday and invite people" },
    ]);
    expect(args[8]).toBe("deep"); // tier
    expect(args[9]).toBe("anthropic,gemini"); // chain
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("rejects oversized history rather than forwarding it", async () => {
    const token = signServiceToken({ issuer: "arena", externalUserId: "u-big", scope: [] });
    await request(app)
      .post("/api/agent/gateway/chat")
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "hi", history: Array.from({ length: 21 }, () => ({ role: "user", content: "x" })) })
      .expect(400);
    expect(routeChatCompletion).not.toHaveBeenCalled();
  });
});
