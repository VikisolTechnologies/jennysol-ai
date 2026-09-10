// M2 (product identity/security) — proves the service-token verifier against a fake product
// ("acme", never a real one) per the architecture's explicit requirement (ADR-003, Phase 8 of
// PROJECT-PROGRESS.md): "to be built and tested against a fake product first." This also
// directly exercises the specific attack scenarios PROJECT-PROGRESS.md's Phase 6 security table
// lists as tests 1-6 (valid, expired, forged, wrong audience, wrong issuer, invalid scope) —
// those move from BLOCKED to real PASS/FAIL evidence starting with this file.

import { describe, it, expect, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import { verifyServiceToken, signServiceToken, ServiceTokenError } from "./serviceToken.js";
import { hasScope, requireScope, InsufficientScopeError } from "./productIdentity.js";

const ACME_SECRET = "acme-test-secret-do-not-use-in-production";
const OTHER_PRODUCT_SECRET = "other-test-secret-do-not-use-in-production";

describe("service token verification (M2) — against a fake 'acme' product connector", () => {
  beforeEach(() => {
    process.env.SERVICE_TOKEN_SECRET_ACME = ACME_SECRET;
    process.env.SERVICE_TOKEN_SECRET_OTHER = OTHER_PRODUCT_SECRET;
    delete process.env.SERVICE_TOKEN_SECRET_UNCONFIGURED;
  });

  it("1. valid token — accepted, resolves to the correct ProductIdentity", () => {
    const token = signServiceToken({
      issuer: "acme",
      externalUserId: "acme-user-42",
      role: "MEMBER",
      tenantId: "acme-tenant-1",
      scope: ["acme.getWidget"],
    });

    const identity = verifyServiceToken(token);

    expect(identity).toEqual({
      product: "acme",
      externalUserId: "acme-user-42",
      role: "MEMBER",
      tenantId: "acme-tenant-1",
      scope: ["acme.getWidget"],
    });
  });

  it("2. expired token — rejected", () => {
    const token = signServiceToken({
      issuer: "acme",
      externalUserId: "acme-user-42",
      scope: [],
      ttlSeconds: -1, // already expired the instant it's minted
    });

    expect(() => verifyServiceToken(token)).toThrow(ServiceTokenError);
    expect(() => verifyServiceToken(token)).toThrow(/expired/i);
  });

  it("3. forged token — a token signed with a different product's secret is rejected even if it claims to be 'acme'", () => {
    // An attacker who controls "other"'s secret cannot mint a token acme's tools will accept —
    // the signature is checked against whichever secret the CLAIMED issuer owns, and a payload
    // signed with the wrong key never verifies against it.
    const forged = jwt.sign(
      { role: "ADMIN", scope: ["acme.deleteEverything"] },
      OTHER_PRODUCT_SECRET, // wrong key for the issuer it's about to claim
      { subject: "attacker", issuer: "acme", audience: "jennysol", expiresIn: 60, algorithm: "HS256" }
    );

    expect(() => verifyServiceToken(forged)).toThrow(ServiceTokenError);
  });

  it("3b. forged token — a token whose payload is tampered with after signing is rejected", () => {
    const token = signServiceToken({ issuer: "acme", externalUserId: "acme-user-42", scope: [] });
    const [header, , signature] = token.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({ sub: "acme-user-42", iss: "acme", aud: "jennysol", scope: ["acme.deleteEverything"] })
    ).toString("base64url");
    const tampered = `${header}.${tamperedPayload}.${signature}`;

    expect(() => verifyServiceToken(tampered)).toThrow(ServiceTokenError);
  });

  it("4. wrong audience — a token not meant for JennySol is rejected", () => {
    const token = jwt.sign(
      { scope: [] },
      ACME_SECRET,
      { subject: "acme-user-42", issuer: "acme", audience: "some-other-service", expiresIn: 60, algorithm: "HS256" }
    );

    expect(() => verifyServiceToken(token)).toThrow(ServiceTokenError);
    expect(() => verifyServiceToken(token)).toThrow(/audience/i);
  });

  it("5. wrong issuer — a token claiming an issuer with no configured secret is rejected", () => {
    const token = jwt.sign(
      { scope: [] },
      "some-random-key-nobody-configured",
      { subject: "someone", issuer: "totally-unconfigured-product", audience: "jennysol", expiresIn: 60, algorithm: "HS256" }
    );

    expect(() => verifyServiceToken(token)).toThrow(/No service-token secret configured/);
  });

  it("6. invalid scope — a valid, correctly-issued token still can't invoke a tool outside its granted scope", () => {
    const token = signServiceToken({
      issuer: "acme",
      externalUserId: "acme-user-42",
      scope: ["acme.getWidget"],
    });
    const identity = verifyServiceToken(token);

    expect(hasScope(identity, "acme.getWidget")).toBe(true);
    expect(hasScope(identity, "acme.deleteEverything")).toBe(false);
    expect(() => requireScope(identity, "acme.deleteEverything")).toThrow(InsufficientScopeError);
    expect(() => requireScope(identity, "acme.getWidget")).not.toThrow();
  });

  it("missing signature/malformed token — rejected, not silently treated as anonymous", () => {
    expect(() => verifyServiceToken("not-a-real-token")).toThrow(ServiceTokenError);
    expect(() => verifyServiceToken("")).toThrow(ServiceTokenError);
  });

  it("a token with no subject claim is rejected even if otherwise validly signed", () => {
    const token = jwt.sign(
      { scope: [] },
      ACME_SECRET,
      { issuer: "acme", audience: "jennysol", expiresIn: 60, algorithm: "HS256" } // no `subject`
    );

    expect(() => verifyServiceToken(token)).toThrow(/subject/i);
  });

  it("end-to-end fake product connector: mint -> verify -> scope-check -> execute a fake tool, only when authorized", () => {
    // This is the M2 acceptance test in full: a pretend "acme" product connector mints a token
    // for one of its own users, JennySol verifies it and checks scope before running anything —
    // exactly the shape a real Arena connector (M5) will use, with zero Arena code involved.
    const FAKE_TOOLS: Record<string, (args: Record<string, unknown>) => unknown> = {
      "acme.getWidget": (args) => ({ widgetId: args.id, name: "Test Widget" }),
    };

    function dispatchFakeTool(identity: ReturnType<typeof verifyServiceToken>, toolName: string, args: Record<string, unknown>) {
      requireScope(identity, toolName);
      return FAKE_TOOLS[toolName](args);
    }

    const authorizedToken = signServiceToken({
      issuer: "acme",
      externalUserId: "acme-user-1",
      scope: ["acme.getWidget"],
    });
    const authorizedIdentity = verifyServiceToken(authorizedToken);
    expect(dispatchFakeTool(authorizedIdentity, "acme.getWidget", { id: "w-1" })).toEqual({
      widgetId: "w-1",
      name: "Test Widget",
    });

    // A different, real acme user whose token was never granted this scope — same product,
    // same tool registry, correctly denied.
    const unauthorizedToken = signServiceToken({
      issuer: "acme",
      externalUserId: "acme-user-2",
      scope: [], // no tools granted
    });
    const unauthorizedIdentity = verifyServiceToken(unauthorizedToken);
    expect(() => dispatchFakeTool(unauthorizedIdentity, "acme.getWidget", { id: "w-1" })).toThrow(
      InsufficientScopeError
    );
  });
});
