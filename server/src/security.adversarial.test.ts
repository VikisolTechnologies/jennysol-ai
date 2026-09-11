// M10 (security testing, PROJECT-PROGRESS.md milestone model) — a DEDICATED adversarial pass
// against the real JennySol<->Arena boundary, distinct from M2/M7/M8/M9's own milestone-scoped
// tests (which this file deliberately does not re-run or re-list — see PROJECT-PROGRESS.md's own
// Phase 6 table for the full cross-reference of what M2/M7/M8/M9 already proved). Every test here
// targets a named attack from this checkpoint's own adversarial list that had NOT previously been
// exercised anywhere else in this codebase: algorithm-confusion, identity injection via request
// body, malicious tool arguments, malformed/failing connector responses, and a real concurrency
// race on single-use pending-action consumption. Runs against the real Express app (supertest),
// the real ToolRegistry, and the real pendingActions store — never a mocked security layer.

import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import request from "supertest";

vi.mock("./services/modelRouter.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./services/modelRouter.js")>();
  return { ...actual, routeChatCompletion: vi.fn() };
});

import { app } from "./app.js";
import { routeChatCompletion } from "./services/modelRouter.js";
import { signServiceToken, verifyServiceToken, ServiceTokenError } from "./services/serviceToken.js";
import { proposeAction } from "./services/tools/pendingActions.js";

const ARENA_SECRET = "arena-test-secret-do-not-use-in-production";

function talentToken(externalUserId: string) {
  return signServiceToken({ issuer: "arena", externalUserId, role: "TALENT", scope: ["arena.searchJobs", "arena.applyToJob"] });
}

describe("M10 — algorithm confusion attacks against the service-token verifier", () => {
  beforeEach(() => {
    process.env.SERVICE_TOKEN_SECRET_ARENA = ARENA_SECRET;
  });

  it("rejects an 'alg: none' unsigned token even with otherwise-perfect claims", () => {
    // jsonwebtoken refuses to *sign* with alg:none by default, so this forges the token by hand:
    // a real header/payload, base64url-encoded, with an EMPTY signature segment — exactly what a
    // classic alg:none attack sends.
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        sub: "attacker",
        iss: "arena",
        aud: "jennysol",
        role: "PLATFORM_ADMIN",
        scope: ["arena.applyToJob", "arena.unlockCandidateContact"],
        exp: Math.floor(Date.now() / 1000) + 300,
      })
    ).toString("base64url");
    const forged = `${header}.${payload}.`;

    expect(() => verifyServiceToken(forged)).toThrow(ServiceTokenError);
  });

  it("rejects a token signed with a different algorithm (HS512) even using the exact correct secret", () => {
    // jsonwebtoken's own algorithm-upgrade footgun (the same one M5 found and fixed on Arena's
    // Java side for HS384) tested from the *attacker's* side this time: even with the real
    // secret, verifyServiceToken's own `algorithms: ["HS256"]` allowlist must reject any other
    // algorithm outright, not just happen to still work for other reasons.
    const forged = jwt.sign(
      { role: "TALENT", scope: ["arena.applyToJob"] },
      ARENA_SECRET,
      { subject: "attacker", issuer: "arena", audience: "jennysol", expiresIn: 300, algorithm: "HS512" }
    );

    expect(() => verifyServiceToken(forged)).toThrow(ServiceTokenError);
  });

  it("rejects a token whose header claims HS256 but whose signature was actually produced with a different secret (classic key-confusion)", () => {
    const forged = jwt.sign(
      { role: "TALENT", scope: ["arena.applyToJob"] },
      "a-completely-different-secret-the-attacker-controls",
      { subject: "attacker", issuer: "arena", audience: "jennysol", expiresIn: 300, algorithm: "HS256" }
    );

    expect(() => verifyServiceToken(forged)).toThrow(ServiceTokenError);
  });
});

describe("M10 — fake ProductIdentity injection via the request body", () => {
  beforeEach(() => {
    vi.mocked(routeChatCompletion).mockReset();
    process.env.SERVICE_TOKEN_SECRET_ARENA = ARENA_SECRET;
  });

  it("a request body claiming an elevated identity/scope has zero effect — only the verified token's identity is ever used", async () => {
    let observedIdentityToolsOffered: string[] = [];
    vi.mocked(routeChatCompletion).mockImplementation(async (_sys, _hist, onDelta, _s, _c, _sig, tools) => {
      observedIdentityToolsOffered = tools?.map((t) => t.name) ?? [];
      onDelta("ok");
      return { providerUsed: "gemini", fellBack: false };
    });

    // Real token: scoped ONLY for arena.searchJobs.
    const token = signServiceToken({ issuer: "arena", externalUserId: "arena-attacker-1", role: "TALENT", scope: ["arena.searchJobs"] });

    const res = await request(app)
      .post("/api/agent/gateway/chat")
      .set("Authorization", `Bearer ${token}`)
      .send({
        message: "hi",
        // Every one of these is a plausible field name an attacker might guess is read by the
        // server — none of them are ever consulted by the real route (which only ever reads
        // req.productIdentity, set exclusively by requireProductIdentity from the verified token).
        productIdentity: { product: "arena", externalUserId: "attacker", role: "PLATFORM_ADMIN", scope: ["arena.applyToJob", "arena.unlockCandidateContact"] },
        identity: { role: "admin" },
        scope: ["arena.applyToJob", "arena.unlockCandidateContact"],
        tenantId: "someone-elses-tenant",
      })
      .expect(200);

    expect(observedIdentityToolsOffered).toEqual(["arena.searchJobs"]);
    expect(res.body.content).toBe("ok");
  });
});

describe("M10 — malicious tool arguments", () => {
  beforeEach(() => {
    vi.mocked(routeChatCompletion).mockReset();
    process.env.SERVICE_TOKEN_SECRET_ARENA = ARENA_SECRET;
  });

  it("a prototype-pollution-shaped arg key does not pollute Object.prototype or crash the request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { content: [] } }) }));
    vi.mocked(routeChatCompletion).mockImplementation(async (_sys, _hist, onDelta, _s, _c, _sig, _tools, onToolCall) => {
      const result = await onToolCall!({
        id: "1",
        name: "arena.searchJobs",
        args: JSON.parse('{"page": 0, "size": 5, "__proto__": {"polluted": true}, "constructor": {"prototype": {"polluted": true}}}'),
      });
      onDelta(JSON.stringify(result));
      return { providerUsed: "gemini", fellBack: false };
    });

    const token = talentToken("arena-attacker-2");
    await request(app)
      .post("/api/agent/gateway/chat")
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "find me jobs" })
      .expect(200);

    expect(({} as any).polluted).toBeUndefined();
  });

  it("an extremely large tool argument does not crash the request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { id: "app-1" } }) }));
    vi.mocked(routeChatCompletion).mockImplementation(async (_sys, _hist, onDelta, _s, _c, _sig, _tools, onToolCall) => {
      const result = await onToolCall!({ id: "1", name: "arena.applyToJob", args: { jobId: "job-1", junk: "x".repeat(2_000_000) } });
      onDelta(JSON.stringify(result));
      return { providerUsed: "gemini", fellBack: false };
    });

    const token = talentToken("arena-attacker-3");
    const res = await request(app)
      .post("/api/agent/gateway/chat")
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "apply me" })
      .expect(200);

    expect(res.body.pendingActions).toHaveLength(1);
  });
});

describe("M10 — malformed/failing connector responses never crash the request", () => {
  beforeEach(() => {
    vi.mocked(routeChatCompletion).mockReset();
    process.env.SERVICE_TOKEN_SECRET_ARENA = ARENA_SECRET;
  });

  it("Arena returning invalid JSON on an HTTP 200 results in a clean 502, not an unhandled crash", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token in JSON");
      },
    }));
    vi.mocked(routeChatCompletion).mockImplementation(async (_sys, _hist, onDelta, _s, _c, _sig, _tools, onToolCall) => {
      await onToolCall!({ id: "1", name: "arena.searchJobs", args: {} });
      onDelta("unreachable");
      return { providerUsed: "gemini", fellBack: false };
    });

    const token = talentToken("arena-attacker-4");
    const res = await request(app)
      .post("/api/agent/gateway/chat")
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "find me jobs" })
      .expect(502);

    expect(res.body.error).toBeTruthy();
  });

  it("a real network failure reaching Arena (connector down) results in a clean 502, not an unhandled crash", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    vi.mocked(routeChatCompletion).mockImplementation(async (_sys, _hist, onDelta, _s, _c, _sig, _tools, onToolCall) => {
      await onToolCall!({ id: "1", name: "arena.searchJobs", args: {} });
      onDelta("unreachable");
      return { providerUsed: "gemini", fellBack: false };
    });

    const token = talentToken("arena-attacker-5");
    const res = await request(app)
      .post("/api/agent/gateway/chat")
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "find me jobs" })
      .expect(502);

    expect(res.body.error).toBeTruthy();
  });
});

describe("M10 — race condition on single-use pending-action consumption", () => {
  beforeEach(() => {
    process.env.SERVICE_TOKEN_SECRET_ARENA = ARENA_SECRET;
  });

  it("two simultaneous approvals of the exact same real actionId: exactly one executes, never both", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { id: "app-1" } }) }));

    const identity = { product: "arena", externalUserId: "arena-race-1", role: "TALENT", scope: ["arena.applyToJob"] };
    const action = proposeAction(identity, "arena.applyToJob", { jobId: "job-1" });
    const token = talentToken("arena-race-1");

    const [first, second] = await Promise.all([
      request(app).post(`/api/agent/gateway/actions/${action.id}`).set("Authorization", `Bearer ${token}`).send({ approve: true }),
      request(app).post(`/api/agent/gateway/actions/${action.id}`).set("Authorization", `Bearer ${token}`).send({ approve: true }),
    ]);

    const statuses = [first.status, second.status].sort();
    // Exactly one 200 (executed) and one 404 (already consumed) — never two 200s, which would
    // mean the real Arena write happened twice for a single user approval.
    expect(statuses).toEqual([200, 404]);
    const executedCount = [first, second].filter((r) => r.status === 200).length;
    expect(executedCount).toBe(1);
  });
});
