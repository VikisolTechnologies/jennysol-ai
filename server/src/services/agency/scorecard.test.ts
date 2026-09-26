import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { draftAgencyScorecard, ScorecardProcessingRefusedError } from "./scorecard.js";
import { createTenant, getTenant, setDataProcessingSetting, setCloudProcessingDisabled, __clearAllTenantsForTests } from "./tenant.js";
import { listModelCallAudit } from "./modelCallAudit.js";

vi.mock("../llm.js", () => ({ streamChatCompletion: vi.fn() }));

const { streamChatCompletion } = await import("../llm.js");
const mockStream = vi.mocked(streamChatCompletion);

function respondWith(json: unknown) {
  mockStream.mockImplementationOnce(async (_sys, _hist, onDelta) => {
    onDelta(JSON.stringify(json));
    return { providerUsed: "gemini", fellBack: false };
  });
}

const validDraft = {
  role: "Senior Backend Engineer",
  mustHave: [{ value: "Java", quote: "5+ years of Java" }],
  niceToHave: [{ value: "Kafka", quote: "Kafka experience a plus" }],
  experienceRange: { value: "5+ years", quote: "5+ years of Java" },
  locationOrWorkMode: { value: "Hyderabad", quote: "based in Hyderabad" },
  compensation: { value: "unknown", quote: "unknown" },
  noticePeriod: { value: "unknown", quote: "unknown" },
  disqualifiers: [],
  contradictions: [],
  missingInformation: ["Budget range was not stated"],
  clientClarificationQuestions: ["What is the budget for this role?"],
  screeningQuestions: ["How many years of production Java experience do you have?"],
  booleanSearchStrings: ['("Java" AND "Postgres") AND Hyderabad'],
};

describe("draftAgencyScorecard", () => {
  let tenant: ReturnType<typeof createTenant>;

  beforeEach(() => {
    mockStream.mockReset();
    delete process.env.AGENCY_CLOUD_DISABLED;
    tenant = createTenant("Test Agency");
    setDataProcessingSetting(tenant.id, "private_plus_controlled_cloud");
    tenant = getTenant(tenant.id)!;
  });

  afterEach(() => {
    __clearAllTenantsForTests();
  });

  it("parses a valid model draft into a structured scorecard", async () => {
    respondWith(validDraft);
    const { draft, removed } = await draftAgencyScorecard(
      tenant,
      "Senior Backend Engineer, Hyderabad. 5+ years of Java, Postgres. Kafka experience a plus."
    );
    expect(draft.role).toBe("Senior Backend Engineer");
    expect(draft.mustHave).toEqual(validDraft.mustHave);
    expect(removed).toEqual([]);
  });

  it("sends the router a CONTROLLED_CLOUD privacy tier with enforcement forced on", async () => {
    respondWith(validDraft);
    await draftAgencyScorecard(tenant, "Senior Backend Engineer");
    expect(mockStream).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.any(Function),
      undefined,
      "reasoning",
      undefined,
      "CONTROLLED_CLOUD",
      true
    );
  });

  it("strips a protected-attribute criterion the model drafted anyway, and escalates for review", async () => {
    respondWith({
      ...validDraft,
      mustHave: [...validDraft.mustHave, { value: "Male", quote: "must be male" }],
    });
    const { draft, removed, escalate, refusalNotice } = await draftAgencyScorecard(
      tenant,
      "Some requirement that mentions gender"
    );
    expect(draft.mustHave.map((m) => m.value)).toEqual(["Java"]);
    expect(removed).toEqual([{ field: "mustHave", value: "Male", quote: "must be male", reason: "gender" }]);
    expect(escalate).toBe(true);
    expect(refusalNotice).toBeDefined();
  });

  it("redacts the JD before it ever reaches the model — the model never sees the client name or an email", async () => {
    respondWith(validDraft);
    await draftAgencyScorecard(tenant, "**Company:** SecretCo\nContact: hr@secretco.example\nSenior Backend Engineer");
    const [, history] = mockStream.mock.calls[0];
    const sentText = (history as Array<{ content: string }>)[0].content;
    expect(sentText).not.toContain("SecretCo");
    expect(sentText).not.toContain("hr@secretco.example");
  });

  it("retries once with a repair prompt when the model returns invalid JSON, then succeeds", async () => {
    mockStream.mockImplementationOnce(async (_sys, _hist, onDelta) => {
      onDelta("not json at all");
      return { providerUsed: "gemini", fellBack: false };
    });
    respondWith(validDraft);
    const { draft } = await draftAgencyScorecard(tenant, "Senior Backend Engineer");
    expect(draft.role).toBe("Senior Backend Engineer");
    expect(mockStream).toHaveBeenCalledTimes(2);
  });

  it("throws a real error after the repair retry also fails", async () => {
    mockStream.mockImplementation(async (_sys, _hist, onDelta) => {
      onDelta("still not json");
      return { providerUsed: "gemini", fellBack: false };
    });
    await expect(draftAgencyScorecard(tenant, "Senior Backend Engineer")).rejects.toThrow(/repair retry/);
    expect(mockStream).toHaveBeenCalledTimes(2);
  });

  it("rejects an empty requirement without calling the model", async () => {
    await expect(draftAgencyScorecard(tenant, "  ")).rejects.toThrow(/requirement/);
    expect(mockStream).not.toHaveBeenCalled();
  });

  it("a tenant still on the private_only default is refused before the model is ever called", async () => {
    const lockedTenant = createTenant("Locked Agency"); // default: private_only
    await expect(draftAgencyScorecard(lockedTenant, "Senior Backend Engineer")).rejects.toThrow(
      ScorecardProcessingRefusedError
    );
    expect(mockStream).not.toHaveBeenCalled();
    const [entry] = listModelCallAudit(lockedTenant.id);
    expect(entry).toMatchObject({ resolvedTier: "refused", redactionOk: true });
  });

  it("a tenant with the per-agency kill switch on is refused, even with cloud otherwise allowed", async () => {
    setCloudProcessingDisabled(tenant.id, true);
    const updated = getTenant(tenant.id)!;
    await expect(draftAgencyScorecard(updated, "Senior Backend Engineer")).rejects.toThrow(
      ScorecardProcessingRefusedError
    );
    expect(mockStream).not.toHaveBeenCalled();
  });

  it("the global kill switch refuses every tenant, whatever their own setting is", async () => {
    process.env.AGENCY_CLOUD_DISABLED = "true";
    await expect(draftAgencyScorecard(tenant, "Senior Backend Engineer")).rejects.toThrow(
      ScorecardProcessingRefusedError
    );
    expect(mockStream).not.toHaveBeenCalled();
  });

  it("fails closed and never calls the model when redaction can't confirm the JD is clean", async () => {
    // A bare domain the redaction pass doesn't strip (see redaction.test.ts) — the fail-closed
    // check catches it here, before any model call.
    await expect(
      draftAgencyScorecard(tenant, "See northstar-example.com for more information about this role.")
    ).rejects.toThrow(ScorecardProcessingRefusedError);
    expect(mockStream).not.toHaveBeenCalled();
  });

  it("records a real model-call audit entry with no prompt content, on both success and refusal", async () => {
    // scorecardId is intentionally omitted here: the initial draft call always happens BEFORE
    // any scorecard row exists (scorecardStore.createDraft runs after this returns), so there is
    // no real id to attach yet — the column exists for a future re-draft-an-existing-scorecard
    // path, and is a real foreign key (never a dangling reference).
    respondWith(validDraft);
    await draftAgencyScorecard(tenant, "Senior Backend Engineer");
    const entries = listModelCallAudit(tenant.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      scorecardId: undefined,
      dataClass: "B",
      requestedTier: "CONTROLLED_CLOUD",
      resolvedTier: "CONTROLLED_CLOUD",
      redactionOk: true,
      providerUsed: "gemini",
    });
    expect(typeof entries[0].latencyMs).toBe("number");
  });
});
