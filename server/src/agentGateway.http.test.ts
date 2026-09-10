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
