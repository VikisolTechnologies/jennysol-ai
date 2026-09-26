import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";

// HTTP-layer test, same rationale as adminAgentSessions.http.test.ts's own header comment: a
// route that wires auth/tenant-membership/validation to the right service call is a different
// claim from the service function working in isolation.
vi.mock("../services/modelRouter.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/modelRouter.js")>();
  return { ...actual, routeChatCompletion: vi.fn() };
});

const { app } = await import("../app.js");
const { routeChatCompletion } = await import("../services/modelRouter.js");
const { createUser } = await import("../services/auth/userStore.js");
const { createSession } = await import("../services/auth/sessions.js");
const { setDataProcessingSetting } = await import("../services/agency/tenant.js");

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

// Creates a tenant via the real route (proving that path too), then opts it into
// CONTROLLED_CLOUD directly (the tenant-settings UI/route isn't built yet — Stage 1 only needs
// this one setting to be reachable by test fixtures, not by a real recruiter).
async function makeCloudEnabledTenant(token: string): Promise<string> {
  const res = await request(app).post("/api/agency/tenants").set("Authorization", `Bearer ${token}`).send({ name: "Test Agency" });
  const tenantId = res.body.tenant.id as string;
  setDataProcessingSetting(tenantId, "private_plus_controlled_cloud");
  return tenantId;
}

describe("agency scorecard routes", () => {
  beforeEach(() => {
    mockRoute.mockReset();
  });

  it("requires auth", async () => {
    const res = await request(app).post("/api/agency/scorecards").send({ requirement: "x" });
    expect(res.status).toBe(401);
  });

  it("requires a tenantId", async () => {
    const { token } = await makeAuth();
    const res = await request(app)
      .post("/api/agency/scorecards")
      .set("Authorization", `Bearer ${token}`)
      .send({ requirement: "Backend Engineer" });
    expect(res.status).toBe(400);
  });

  it("refuses a tenant the caller isn't a member of", async () => {
    const owner = await makeAuth();
    const stranger = await makeAuth();
    const tenantId = await makeCloudEnabledTenant(owner.token);
    const res = await request(app)
      .post("/api/agency/scorecards")
      .set("Authorization", `Bearer ${stranger.token}`)
      .send({ tenantId, requirement: "Backend Engineer" });
    expect(res.status).toBe(404);
  });

  it("drafts, edits, and approves a scorecard end to end, scoped to its tenant", async () => {
    const owner = await makeAuth();
    const stranger = await makeAuth();
    const tenantId = await makeCloudEnabledTenant(owner.token);

    mockDraftResponse(validDraft);
    const created = await request(app)
      .post("/api/agency/scorecards")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ tenantId, requirement: "Backend Engineer, 5 years of Java" });
    expect(created.status).toBe(201);
    expect(created.body.scorecard.status).toBe("draft");
    const id = created.body.scorecard.id;

    // A user who isn't a member of this tenant can't read, edit, or approve its scorecard.
    const strangerGet = await request(app)
      .get(`/api/agency/scorecards/${id}?tenantId=${tenantId}`)
      .set("Authorization", `Bearer ${stranger.token}`);
    expect(strangerGet.status).toBe(404);

    const edited = await request(app)
      .patch(`/api/agency/scorecards/${id}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ tenantId, compensation: { value: "12L", quote: "12L fixed" } });
    expect(edited.status).toBe(200);
    expect(edited.body.scorecard.scorecard.compensation.value).toBe("12L");
    expect(edited.body.scorecard.version).toBe(2);

    const approved = await request(app)
      .post(`/api/agency/scorecards/${id}/approve`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ tenantId });
    expect(approved.status).toBe(200);
    expect(approved.body.scorecard.status).toBe("approved");

    // Editing after approval is refused.
    const editAfterApprove = await request(app)
      .patch(`/api/agency/scorecards/${id}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ tenantId, compensation: { value: "15L", quote: "15L" } });
    expect(editAfterApprove.status).toBe(409);

    const list = await request(app)
      .get(`/api/agency/scorecards?tenantId=${tenantId}`)
      .set("Authorization", `Bearer ${owner.token}`);
    expect(list.body.scorecards.map((s: { id: string }) => s.id)).toEqual([id]);
  });

  it("a scorecard flagged requiresReview refuses a plain approve until reviewed:true is sent", async () => {
    const owner = await makeAuth();
    const tenantId = await makeCloudEnabledTenant(owner.token);

    mockDraftResponse({ ...validDraft, disqualifiers: [{ value: "under 30", quote: "must be under 30" }] });
    const created = await request(app)
      .post("/api/agency/scorecards")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ tenantId, requirement: "Backend Engineer, must be under 30" });
    expect(created.body.scorecard.requiresReview).toBe(true);
    expect(created.body.scorecard.refusalNotice).toBeDefined();
    const id = created.body.scorecard.id;

    const plainApprove = await request(app)
      .post(`/api/agency/scorecards/${id}/approve`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ tenantId });
    expect(plainApprove.status).toBe(409);
    expect(plainApprove.body.code).toBe("requires_review");

    const reviewedApprove = await request(app)
      .post(`/api/agency/scorecards/${id}/approve`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ tenantId, reviewed: true });
    expect(reviewedApprove.status).toBe(200);
    expect(reviewedApprove.body.scorecard.status).toBe("approved");
  });

  it("refuses to draft for a tenant still on the private_only default (no cloud processor opted in)", async () => {
    const owner = await makeAuth();
    const res = await request(app).post("/api/agency/tenants").set("Authorization", `Bearer ${owner.token}`).send({ name: "Locked Agency" });
    const tenantId = res.body.tenant.id as string;

    const draftRes = await request(app)
      .post("/api/agency/scorecards")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ tenantId, requirement: "Backend Engineer" });
    expect(draftRes.status).toBe(422);
    expect(mockRoute).not.toHaveBeenCalled();
  });

  it("rejects a blank requirement", async () => {
    const owner = await makeAuth();
    const tenantId = await makeCloudEnabledTenant(owner.token);
    const res = await request(app)
      .post("/api/agency/scorecards")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ tenantId, requirement: "  " });
    expect(res.status).toBe(400);
  });
});
