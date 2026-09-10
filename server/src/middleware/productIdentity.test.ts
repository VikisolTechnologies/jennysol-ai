// M6 (agent gateway) — direct unit tests of the middleware, matching this codebase's existing
// convention of testing Express middleware as a plain function against mock req/res objects
// rather than through a running HTTP server (see this project's own documented gap: no
// automated test drives an actual HTTP route end-to-end today, for any route in this codebase,
// not just this new one). The gateway route's own live behavior (this middleware wired into the
// real Express app, hit with a real HTTP request) was verified manually — see
// PROJECT-PROGRESS.md's M6 entry.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { requireProductIdentity } from "./productIdentity.js";
import { signServiceToken } from "../services/serviceToken.js";

function mockReq(authHeader?: string): Request {
  return {
    header: (name: string) => (name.toLowerCase() === "authorization" ? authHeader : undefined),
  } as unknown as Request;
}

function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res as unknown as Response & typeof res;
}

describe("requireProductIdentity (M6)", () => {
  beforeEach(() => {
    process.env.SERVICE_TOKEN_SECRET_ARENA = "arena-test-secret-do-not-use-in-production";
  });

  it("rejects a request with no Authorization header", () => {
    const req = mockReq(undefined);
    const res = mockRes();
    const next = vi.fn();

    requireProductIdentity(req, res, next as NextFunction);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: "Missing service token" });
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a non-Bearer Authorization header", () => {
    const req = mockReq("Basic abc123");
    const res = mockRes();
    const next = vi.fn();

    requireProductIdentity(req, res, next as NextFunction);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a malformed/invalid token with a clear error, not a crash", () => {
    const req = mockReq("Bearer not-a-real-token");
    const res = mockRes();
    const next = vi.fn();

    requireProductIdentity(req, res, next as NextFunction);

    expect(res.statusCode).toBe(401);
    expect(typeof res.body).toBe("object");
    expect(next).not.toHaveBeenCalled();
  });

  it("accepts a valid service token and attaches the resolved identity to the request", () => {
    const token = signServiceToken({
      issuer: "arena",
      externalUserId: "arena-user-1",
      role: "TALENT",
      scope: ["arena.searchJobs"],
    });
    const req = mockReq(`Bearer ${token}`);
    const res = mockRes();
    const next = vi.fn();

    requireProductIdentity(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.productIdentity).toEqual({
      product: "arena",
      externalUserId: "arena-user-1",
      role: "TALENT",
      tenantId: undefined,
      scope: ["arena.searchJobs"],
    });
  });
});
