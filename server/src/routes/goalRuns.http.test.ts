import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";

// HTTP-layer test for the new /:id/actions/:actionId route (docs/reviews/d27386b.md STEP 4.1) —
// same rationale as the other *.http.test.ts files in this repo: a route that wires
// auth/ownership/validation to resumeAfterApproval is a different claim from that function
// working in isolation (already covered in agentRuntime/runtime.test.ts).
vi.mock("../services/modelRouter.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/modelRouter.js")>();
  return { ...actual, routeChatCompletion: vi.fn() };
});

const { app } = await import("../app.js");
const { routeChatCompletion } = await import("../services/modelRouter.js");
const { createUser } = await import("../services/auth/userStore.js");
const { createSession } = await import("../services/auth/sessions.js");

const mockRoute = routeChatCompletion as unknown as ReturnType<typeof vi.fn>;

function mockPlainReply(text: string) {
  mockRoute.mockImplementationOnce(async (_sys: string, _hist: unknown, onDelta: (t: string) => void) => {
    onDelta(text);
    return { providerUsed: "gemini", fellBack: false };
  });
}

async function makeAuth() {
  const user = createUser(`${randomUUID()}@example.test`, "x", "Test User", "candidate");
  const { token } = createSession(user.id);
  return { token, userId: user.id };
}

describe("POST /api/goal-runs/:id/actions/:actionId", () => {
  beforeEach(() => {
    mockRoute.mockReset();
  });

  it("requires auth", async () => {
    const res = await request(app).post(`/api/goal-runs/${randomUUID()}/actions/${randomUUID()}`).send({ approve: true });
    expect(res.status).toBe(401);
  });

  it("rejects a non-boolean approve field", async () => {
    const { token } = await makeAuth();
    const res = await request(app)
      .post(`/api/goal-runs/${randomUUID()}/actions/${randomUUID()}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ approve: "yes" });
    expect(res.status).toBe(400);
  });

  it("refuses to resolve an action for a run that doesn't exist (or isn't this user's)", async () => {
    const { token } = await makeAuth();
    const res = await request(app)
      .post(`/api/goal-runs/${randomUUID()}/actions/${randomUUID()}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ approve: true });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/No such run/);
  });

  it("refuses to resolve an action on a run that already completed without ever pausing", async () => {
    const { token } = await makeAuth();
    mockPlainReply("Here's the answer, no tool needed.");
    const created = await request(app)
      .post("/api/goal-runs")
      .set("Authorization", `Bearer ${token}`)
      .send({ goal: "what's a good icebreaker question" });
    expect(created.status).toBe(201);
    const runId = created.body.run.id;

    const res = await request(app)
      .post(`/api/goal-runs/${runId}/actions/${randomUUID()}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ approve: true });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/no pending approval/);
  });

  it("a different signed-in user can't resolve someone else's run", async () => {
    const owner = await makeAuth();
    const stranger = await makeAuth();
    mockPlainReply("Here's the answer.");
    const created = await request(app)
      .post("/api/goal-runs")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ goal: "hello" });
    const runId = created.body.run.id;

    const res = await request(app)
      .post(`/api/goal-runs/${runId}/actions/${randomUUID()}`)
      .set("Authorization", `Bearer ${stranger.token}`)
      .send({ approve: true });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/No such run/);
  });
});
