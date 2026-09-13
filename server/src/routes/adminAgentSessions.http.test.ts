import { describe, it, expect, vi, afterEach, afterAll } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Real HTTP-layer tests for Stage A/B of JENNYSOL-AGENTS-UI-FIRST.md's new admin routes (start a
// session, pause/resume/cancel/kill, the approval queue) — same rationale as httpRoutes.test.ts's own
// header comment: a route that wires auth/validation to the right service call is a different claim
// from the service function working in isolation, and only an HTTP-layer test catches the former.
//
// AGENT_WORKSPACE_ROOT must be a throwaway tmp dir, set BEFORE app.js (which transitively imports
// agentToolRegistry.js -> agentWorkspace.js, whose WORKSPACE_ROOT is computed once at module load)
// is ever imported — the approval-queue tests below really approve a real file.write, and without
// this override that write would land in the real repo root. Same static-vs-dynamic-import ESM
// hoisting rule already caught twice elsewhere this session: every import that touches that module
// graph must be dynamic, after this assignment, never a static top-level import.
const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "admin-agent-sessions-http-test-"));
process.env.AGENT_WORKSPACE_ROOT = tmpRoot;
afterAll(() => {
  delete process.env.AGENT_WORKSPACE_ROOT;
  rmSync(tmpRoot, { recursive: true, force: true });
});

vi.mock("../services/modelRouter.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/modelRouter.js")>();
  return { ...actual, routeChatCompletion: vi.fn() };
});

const { app } = await import("../app.js");
const { routeChatCompletion } = await import("../services/modelRouter.js");
const { db } = await import("../db/index.js");
const { createUser } = await import("../services/auth/userStore.js");
const { createSession: createAuthSession } = await import("../services/auth/sessions.js");
const { createSession: createAgentSession } = await import("../services/agentSessionStore.js");
const { spawnAgent } = await import("../services/agentRegistry.js");
const { proposeAgentAction } = await import("../services/agentToolRegistry.js");

type RouteResult = Awaited<ReturnType<typeof routeChatCompletion>>;
const mockRoute = routeChatCompletion as unknown as ReturnType<typeof vi.fn>;

function mockDecomposition(tasks: unknown[]) {
  mockRoute.mockImplementation(async (_sys: string, _hist: unknown, onDelta: (t: string) => void) => {
    onDelta(JSON.stringify(tasks));
    return { providerUsed: "gemini", fellBack: false, taskCapability: "reasoning", attempts: [] } as RouteResult;
  });
}

async function makeAuth(role: "admin" | "candidate" = "admin") {
  const user = createUser(`${randomUUID()}@example.test`, "x", "Test User", role);
  const { token } = createAuthSession(user.id);
  return { token, userId: user.id };
}

async function waitFor(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timed out");
}

function sessionStatus(id: string): string {
  return (db.prepare("SELECT status FROM agent_sessions WHERE id = ?").get(id) as { status: string }).status;
}

describe("HTTP — admin agent-sessions control surface", () => {
  afterEach(() => {
    mockRoute.mockReset();
  });

  it("requires auth on every new route", async () => {
    await request(app).post("/api/admin/agent-sessions").send({ objective: "x" }).expect(401);
    await request(app).get("/api/admin/agent-actions/pending").expect(401);
  });

  it("requires admin, not just any authenticated user", async () => {
    const { token } = await makeAuth("candidate");
    await request(app)
      .post("/api/admin/agent-sessions")
      .set("Authorization", `Bearer ${token}`)
      .send({ objective: "x" })
      .expect(403);
  });

  it("rejects an empty objective as a real 400, not a session nobody can ever run", async () => {
    const { token } = await makeAuth();
    await request(app)
      .post("/api/admin/agent-sessions")
      .set("Authorization", `Bearer ${token}`)
      .send({ objective: "" })
      .expect(400);
  });

  it("starts a real session over HTTP and really decomposes it in the background", async () => {
    const { token } = await makeAuth();
    mockDecomposition([{ localId: "T1", role: "architect", title: "Decide approach" }]);

    const res = await request(app)
      .post("/api/admin/agent-sessions")
      .set("Authorization", `Bearer ${token}`)
      .send({ objective: "Add a ping endpoint" })
      .expect(201);
    expect(res.body.session.status).toBe("planning");
    const sessionId = res.body.session.id as string;

    // The route responds before decomposition runs (fire-and-forget, matching chatRunner's own
    // shape) — real proof this isn't just returning a canned 201 is that the session's real status
    // and real tasks show up moments later, not synchronously in the response above.
    await waitFor(() => sessionStatus(sessionId) === "running" || sessionStatus(sessionId) === "completed");

    const detail = await request(app)
      .get(`/api/admin/agent-sessions/${sessionId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(detail.body.tasks.length).toBeGreaterThan(0);
  });

  it("pause/resume/cancel a session over HTTP are real, durable transitions", async () => {
    const { token, userId } = await makeAuth();
    const session = createAgentSession({ userId, objective: "x" });

    await request(app).post(`/api/admin/agent-sessions/${session.id}/pause`).set("Authorization", `Bearer ${token}`).expect(200);
    expect(sessionStatus(session.id)).toBe("paused");

    await request(app).post(`/api/admin/agent-sessions/${session.id}/resume`).set("Authorization", `Bearer ${token}`).expect(200);
    expect(sessionStatus(session.id)).toBe("running");

    await request(app).post(`/api/admin/agent-sessions/${session.id}/cancel`).set("Authorization", `Bearer ${token}`).expect(200);
    expect(sessionStatus(session.id)).toBe("cancelled");
  });

  it("pausing a session that doesn't exist is a real 400, not a silent success", async () => {
    const { token } = await makeAuth();
    await request(app)
      .post(`/api/admin/agent-sessions/${randomUUID()}/pause`)
      .set("Authorization", `Bearer ${token}`)
      .expect(400);
  });

  it("kills one agent over HTTP without touching its siblings", async () => {
    const { token, userId } = await makeAuth();
    const session = createAgentSession({ userId, objective: "x" });
    const agentA = spawnAgent(session.id, "coder");
    const agentB = spawnAgent(session.id, "qa");

    await request(app)
      .post(`/api/admin/agent-sessions/${session.id}/agents/${agentA.id}/kill`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const detail = await request(app)
      .get(`/api/admin/agent-sessions/${session.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const rowA = detail.body.agents.find((a: { id: string }) => a.id === agentA.id);
    const rowB = detail.body.agents.find((a: { id: string }) => a.id === agentB.id);
    expect(rowA.status).toBe("cancelled");
    expect(rowB.status).toBe("idle");
  });

  it("the approval queue over HTTP: list and approve are a real decision, not a UI-only label", async () => {
    const { token, userId } = await makeAuth();
    const session = createAgentSession({ userId, objective: "x" });
    const agent = spawnAgent(session.id, "coder");
    const action = proposeAgentAction(session.id, agent.id, "file.write", { filePath: "http-approved.txt", content: "hi" });

    const pending = await request(app)
      .get("/api/admin/agent-actions/pending")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(pending.body.actions.some((a: { id: string }) => a.id === action.id)).toBe(true);

    await request(app).post(`/api/admin/agent-actions/${action.id}/approve`).set("Authorization", `Bearer ${token}`).expect(200);

    const fs = await import("node:fs/promises");
    const written = await fs.readFile(path.join(tmpRoot, "http-approved.txt"), "utf8");
    expect(written).toBe("hi");

    const stillPending = await request(app)
      .get("/api/admin/agent-actions/pending")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(stillPending.body.actions.some((a: { id: string }) => a.id === action.id)).toBe(false);
  });

  it("rejecting an already-decided action over HTTP is a real 400, not a silent success", async () => {
    const { token, userId } = await makeAuth();
    const session = createAgentSession({ userId, objective: "x" });
    const agent = spawnAgent(session.id, "coder");
    const action = proposeAgentAction(session.id, agent.id, "file.write", { filePath: "http-rejected.txt", content: "hi" });

    await request(app).post(`/api/admin/agent-actions/${action.id}/reject`).set("Authorization", `Bearer ${token}`).expect(200);
    await request(app).post(`/api/admin/agent-actions/${action.id}/reject`).set("Authorization", `Bearer ${token}`).expect(400);

    const fs = await import("node:fs/promises");
    await expect(fs.access(path.join(tmpRoot, "http-rejected.txt"))).rejects.toThrow();
  });
});
