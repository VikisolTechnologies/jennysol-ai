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

import { app } from "./app.js";
import { routeChatCompletion } from "./services/modelRouter.js";
import { signServiceToken } from "./services/serviceToken.js";

const ARENA_SECRET = "arena-test-secret-do-not-use-in-production";

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

    expect(res.body.content).toContain('"content":[]');
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

    expect(approveRes.body).toEqual({ status: "executed", result: { id: "app-1", jobId: "job-42" } });
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
