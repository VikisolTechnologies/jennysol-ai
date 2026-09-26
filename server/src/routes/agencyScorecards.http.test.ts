import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";

// HTTP-layer test, same rationale as adminAgentSessions.http.test.ts's own header comment: a
// route that wires auth/ownership/validation to the right service call is a different claim from
// the service function working in isolation.
vi.mock("../services/modelRouter.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/modelRouter.js")>();
  return { ...actual, routeChatCompletion: vi.fn() };
});

const { app } = await import("../app.js");
const { routeChatCompletion } = await import("../services/modelRouter.js");
const { createUser } = await import("../services/auth/userStore.js");
const { createSession } = await import("../services/auth/sessions.js");

const mockRoute = routeChatCompletion as unknown as ReturnType<typeof vi.fn>;

const validDraft = {
  role: "Backend Engineer",
  mustHave: [{ value: "Java", quote: "5 years of Java" }],
  niceToHave: [],
  experienceRange: { value: "5+ years", quote: "5 years of Java" },
  locationOrWorkMode: { value: "unknown", quote: "unknown" },
  compensation: { value: "unknown", quote: "unknown" },
  noticePeriod: { value: "unknown", quote: "unknown" },
  disqualifiers: [],
  contradictions: [],
  missingInformation: [],
  clientClarificationQuestions: [],
  screeningQuestions: [],
  booleanSearchStrings: [],
};

function mockDraftResponse(json: unknown) {
  mockRoute.mockImplementationOnce(async (_sys: string, _hist: unknown, onDelta: (t: string) => void) => {
    onDelta(JSON.stringify(json));
    return { providerUsed: "gemini", fellBack: false };
  });
}

async function makeAuth() {
  const user = createUser(`${randomUUID()}@example.test`, "x", "Test User", "candidate");
  const { token } = createSession(user.id);
  return { token, userId: user.id };
}

describe("agency scorecard routes", () => {
  it("requires auth", async () => {
    const res = await request(app).post("/api/agency/scorecards").send({ requirement: "x" });
    expect(res.status).toBe(401);
  });

  it("drafts, edits, and approves a scorecard end to end, scoped to its owner", async () => {
    const owner = await makeAuth();
    const stranger = await makeAuth();

    mockDraftResponse(validDraft);
    const created = await request(app)
      .post("/api/agency/scorecards")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ requirement: "Backend Engineer, 5 years of Java" });
    expect(created.status).toBe(201);
    expect(created.body.scorecard.status).toBe("draft");
    const id = created.body.scorecard.id;

    // A different user can't read, edit, or approve someone else's scorecard.
    const strangerGet = await request(app)
      .get(`/api/agency/scorecards/${id}`)
      .set("Authorization", `Bearer ${stranger.token}`);
    expect(strangerGet.status).toBe(404);

    const edited = await request(app)
      .patch(`/api/agency/scorecards/${id}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ compensation: { value: "12L", quote: "12L fixed" } });
    expect(edited.status).toBe(200);
    expect(edited.body.scorecard.scorecard.compensation.value).toBe("12L");
    expect(edited.body.scorecard.version).toBe(2);

    const approved = await request(app)
      .post(`/api/agency/scorecards/${id}/approve`)
      .set("Authorization", `Bearer ${owner.token}`);
    expect(approved.status).toBe(200);
    expect(approved.body.scorecard.status).toBe("approved");

    // Editing after approval is refused.
    const editAfterApprove = await request(app)
      .patch(`/api/agency/scorecards/${id}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ compensation: { value: "15L", quote: "15L" } });
    expect(editAfterApprove.status).toBe(409);

    const list = await request(app).get("/api/agency/scorecards").set("Authorization", `Bearer ${owner.token}`);
    expect(list.body.scorecards.map((s: { id: string }) => s.id)).toEqual([id]);
  });

  it("rejects a blank requirement", async () => {
    const owner = await makeAuth();
    const res = await request(app)
      .post("/api/agency/scorecards")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ requirement: "  " });
    expect(res.status).toBe(400);
  });
});
