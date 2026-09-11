// M5/M6 (Arena connector) — the first test in this repository that touches a real, named
// product instead of a fake one ("acme"/"widgetco" in M2/M3/M4's tests). Proves the full
// pipeline (a token shaped exactly like Arena's real issuer produces → verifyServiceToken →
// ToolRegistry) works for the real `arenaConnector`, using JennySol's own signServiceToken() to
// mint the test token — the same mechanism M2 already tests, now with issuer "arena" — and (M6)
// that `arena.searchJobs` correctly calls Arena's real API contract (mocked at the `fetch` layer
// only, not re-implementing Arena's own logic).
//
// This does NOT re-run the M5 cross-language proof against Arena's actual Java
// AgentServiceTokenIssuer — that requires invoking Maven from outside this Node test suite, out
// of scope for an automated `npm test` run. That proof was performed live, once, during M5's own
// implementation (a real token minted by arena-api's AgentServiceTokenIssuer was accepted here,
// and a tampered copy of it was correctly rejected) and is recorded as verified evidence in
// PROJECT-PROGRESS.md's M5 entry — the same "verified live, at the time" pattern this project's
// own docs already use for checks that can't be kept re-proving in CI. What this file proves
// permanently is that JennySol's own side of that contract (the connector, the verifier, the
// registry, and now the real tool) keeps behaving correctly on every future change.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { arenaConnector } from "./arena.js";
import { signServiceToken, verifyServiceToken } from "../serviceToken.js";
import { ToolRegistry } from "../tools/toolRegistry.js";

const ARENA_SECRET = "arena-test-secret-do-not-use-in-production";

describe("arenaConnector (M5/M6)", () => {
  beforeEach(() => {
    delete process.env.SERVICE_TOKEN_SECRET_ARENA;
  });

  it("identifies itself as the 'arena' product", () => {
    expect(arenaConnector.product).toBe("arena");
  });

  it("exposes exactly the arena.searchJobs and arena.applyToJob tools, correctly namespaced", () => {
    const tools = arenaConnector.getTools();
    expect(tools.map((t) => t.name)).toEqual(["arena.searchJobs", "arena.applyToJob"]);
  });

  it("arena.searchJobs's own description is honest that Arena has no keyword search yet", () => {
    const [tool] = arenaConnector.getTools();
    expect(tool.description.toLowerCase()).toContain("does not currently support keyword");
  });

  it("M7: arena.searchJobs is tier READ and arena.applyToJob is tier WRITE", () => {
    const tools = arenaConnector.getTools();
    expect(tools.find((t) => t.name === "arena.searchJobs")!.tier).toBe("READ");
    expect(tools.find((t) => t.name === "arena.applyToJob")!.tier).toBe("WRITE");
  });

  it("configured() reflects whether SERVICE_TOKEN_SECRET_ARENA is actually set", () => {
    expect(arenaConnector.configured()).toBe(false);
    process.env.SERVICE_TOKEN_SECRET_ARENA = ARENA_SECRET;
    expect(arenaConnector.configured()).toBe(true);
  });

  it("end-to-end: a token shaped exactly like Arena's real issuer produces it resolves through the real registry", () => {
    process.env.SERVICE_TOKEN_SECRET_ARENA = ARENA_SECRET;

    const registry = new ToolRegistry();
    registry.registerConnector(arenaConnector);

    // Same claim shape arena-api's AgentServiceTokenIssuer.java produces: sub, iss="arena",
    // aud="jennysol", role, tenantId, scope — signed here with JennySol's own signer rather than
    // invoking Maven, per this file's own header comment.
    const token = signServiceToken({
      issuer: "arena",
      externalUserId: "arena-user-42",
      role: "RECRUITER",
      tenantId: "tenant-1",
      scope: ["arena.searchJobs"],
    });

    const identity = verifyServiceToken(token);

    expect(identity).toEqual({
      product: "arena",
      externalUserId: "arena-user-42",
      role: "RECRUITER",
      tenantId: "tenant-1",
      scope: ["arena.searchJobs"],
    });

    expect(registry.getToolsFor(identity).map((t) => t.name)).toEqual(["arena.searchJobs"]);
  });

  it("a tampered arena-shaped token is rejected by the real verifier, not silently accepted", () => {
    process.env.SERVICE_TOKEN_SECRET_ARENA = ARENA_SECRET;

    const token = signServiceToken({
      issuer: "arena",
      externalUserId: "arena-user-42",
      scope: ["arena.searchJobs"],
    });
    const [header, , signature] = token.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({ sub: "arena-user-42", iss: "arena", aud: "jennysol", role: "PLATFORM_ADMIN", scope: ["arena.unlockCandidateContact"] })
    ).toString("base64url");
    const tampered = `${header}.${tamperedPayload}.${signature}`;

    expect(() => verifyServiceToken(tampered)).toThrow();
  });
});

// M6: arena.searchJobs's real execution — mocked only at the global `fetch` boundary, exercising
// this file's actual request-building/response-parsing logic against Arena's real API contract
// (JobController.java's GET /jobs: page/size only, ApiResponse<PagedResponse<JobResponse>>
// envelope) rather than re-implementing Arena's own logic in the mock.
describe("arena.searchJobs execution (M6)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  function tool() {
    return arenaConnector.getTools().find((t) => t.name === "arena.searchJobs")!;
  }

  it("calls Arena's real GET /jobs with page/size and returns the unwrapped data", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: { content: [{ id: "job-1", title: "Senior React Engineer" }], page: 0, size: 20 },
      }),
    });

    const result = await tool().execute(
      { product: "arena", externalUserId: "u1", scope: [] },
      { page: 0, size: 20 },
      { rawToken: "test-token" }
    );

    expect(fetchMock).toHaveBeenCalledWith("https://api-arena.vikisol.in/api/v1/jobs?page=0&size=20");
    expect(result).toEqual({ content: [{ id: "job-1", title: "Senior React Engineer" }], page: 0, size: 20 });
  });

  it("defaults page/size and clamps an oversized page size to Arena's real limit", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, data: { content: [] } }) });

    await tool().execute({ product: "arena", externalUserId: "u1", scope: [] }, { size: 9999 }, { rawToken: "test-token" });

    expect(fetchMock).toHaveBeenCalledWith("https://api-arena.vikisol.in/api/v1/jobs?page=0&size=50");
  });

  it("throws (never silently returns empty) on a non-OK HTTP response from Arena", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });

    await expect(
      tool().execute({ product: "arena", externalUserId: "u1", scope: [] }, {}, { rawToken: "test-token" })
    ).rejects.toThrow(/503/);
  });

  it("throws on Arena's own envelope reporting success:false, surfacing Arena's real message", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: false, message: "Something went wrong on Arena's side" }),
    });

    await expect(
      tool().execute({ product: "arena", externalUserId: "u1", scope: [] }, {}, { rawToken: "test-token" })
    ).rejects.toThrow("Something went wrong on Arena's side");
  });

  it("respects ARENA_API_BASE_URL for a non-production Arena deployment", async () => {
    process.env.ARENA_API_BASE_URL = "http://localhost:8080";
    vi.resetModules();
    const { arenaConnector: freshConnector } = await import("./arena.js");
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, data: {} }) });

    await freshConnector
      .getTools()
      .find((t) => t.name === "arena.searchJobs")!
      .execute({ product: "arena", externalUserId: "u1", scope: [] }, {}, { rawToken: "test-token" });

    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8080/jobs?page=0&size=20");
    delete process.env.ARENA_API_BASE_URL;
  });
});

// M7: arena.applyToJob's real execution — a WRITE tool that must forward the exact rawToken it's
// given as its own request's Authorization header (the round-trip service-token design), never
// mint or invent a credential of its own.
describe("arena.applyToJob execution (M7)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  function tool() {
    return arenaConnector.getTools().find((t) => t.name === "arena.applyToJob")!;
  }

  it("POSTs to Arena's real /applications with jobId and forwards context.rawToken as the Authorization header", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { id: "app-1", jobId: "job-42" } }),
    });

    const result = await tool().execute(
      { product: "arena", externalUserId: "u1", scope: [] },
      { jobId: "job-42" },
      { rawToken: "the-exact-service-token" }
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api-arena.vikisol.in/api/v1/applications",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer the-exact-service-token" }),
        body: JSON.stringify({ jobId: "job-42" }),
      })
    );
    expect(result).toEqual({ id: "app-1", jobId: "job-42" });
  });

  it("throws when called without a jobId", async () => {
    await expect(
      tool().execute({ product: "arena", externalUserId: "u1", scope: [] }, {}, { rawToken: "test-token" })
    ).rejects.toThrow(/jobId/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws (never silently succeeds) when Arena rejects the application", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ success: false, message: "Only TALENT accounts may apply" }),
    });

    await expect(
      tool().execute(
        { product: "arena", externalUserId: "u1", scope: [] },
        { jobId: "job-42" },
        { rawToken: "test-token" }
      )
    ).rejects.toThrow("Only TALENT accounts may apply");
  });

  // M8 (acceptance test F): the round-trip token this tool forwards must never end up embedded
  // in a thrown Error's own message — that message is exactly the kind of string a caller further
  // up the stack (e.g. app.ts's global error handler) can end up persisting to error_logs. Arena's
  // own error message is untrusted content this connector already treats as data, never
  // instructions (see the honesty note on searchJobs); this proves the token specifically can
  // never ride along inside it either way.
  it("a failure never leaks context.rawToken into the thrown error's own message", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ success: false, message: "Rejected" }),
    });

    const rawToken = "the-exact-service-token-must-not-leak";
    try {
      await tool().execute({ product: "arena", externalUserId: "u1", scope: [] }, { jobId: "job-42" }, { rawToken });
      throw new Error("expected tool().execute to throw");
    } catch (err) {
      expect(err instanceof Error ? err.message : String(err)).not.toContain(rawToken);
    }
  });
});
