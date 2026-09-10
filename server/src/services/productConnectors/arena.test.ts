// M5 (Arena connector) — the first test in this repository that touches a real, named product
// instead of a fake one ("acme"/"widgetco" in M2/M3/M4's tests). Proves the full pipeline (a
// token shaped exactly like Arena's real issuer produces → verifyServiceToken → ToolRegistry)
// works for the real `arenaConnector`, using JennySol's own signServiceToken() to mint the test
// token — the same mechanism M2 already tests, now with issuer "arena".
//
// This does NOT re-run the cross-language proof against Arena's actual Java
// AgentServiceTokenIssuer — that requires invoking Maven from outside this Node test suite, out
// of scope for an automated `npm test` run. That proof was performed live, once, during M5's own
// implementation (a real token minted by arena-api's AgentServiceTokenIssuer was accepted here,
// and a tampered copy of it was correctly rejected) and is recorded as verified evidence in
// PROJECT-PROGRESS.md's M5 entry — the same "verified live, at the time" pattern this project's
// own docs already use for checks that can't be kept re-proving in CI. What this file proves
// permanently is that JennySol's own side of that contract (the connector, the verifier, the
// registry) keeps behaving correctly on every future change.

import { describe, it, expect, beforeEach } from "vitest";
import { arenaConnector } from "./arena.js";
import { signServiceToken, verifyServiceToken } from "../serviceToken.js";
import { ToolRegistry } from "../tools/toolRegistry.js";

const ARENA_SECRET = "arena-test-secret-do-not-use-in-production";

describe("arenaConnector (M5)", () => {
  beforeEach(() => {
    delete process.env.SERVICE_TOKEN_SECRET_ARENA;
  });

  it("identifies itself as the 'arena' product", () => {
    expect(arenaConnector.product).toBe("arena");
  });

  it("has no tools yet — that's M6's job, not M5's", () => {
    expect(arenaConnector.getTools()).toEqual([]);
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

    // No tools exist yet (M6), so this must return empty rather than throw — a real Arena
    // identity querying the registry today gets an honest "nothing available," not an error.
    expect(registry.getToolsFor(identity)).toEqual([]);
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
