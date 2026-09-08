import { describe, it, expect } from "vitest";
import { classifyError, isRetryableNow, affectsProviderHealth } from "./retryClassifier.js";

function errWithStatus(status: number, message = "error"): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

describe("classifyError", () => {
  it("classifies 401/403 as auth", () => {
    expect(classifyError(errWithStatus(401))).toBe("auth");
    expect(classifyError(errWithStatus(403))).toBe("auth");
  });

  it("classifies 400 as invalid_request", () => {
    expect(classifyError(errWithStatus(400))).toBe("invalid_request");
  });

  it("classifies 503 as 503", () => {
    expect(classifyError(errWithStatus(503))).toBe("503");
  });

  it("classifies a plain 429 as 429", () => {
    expect(classifyError(errWithStatus(429, "Too many requests"))).toBe("429");
  });

  it("classifies a 429 carrying RESOURCE_EXHAUSTED as quota, not a plain rate limit", () => {
    expect(classifyError(errWithStatus(429, '{"status":"RESOURCE_EXHAUSTED"}'))).toBe("quota");
  });

  it("classifies network-shaped messages as timeout even without a status", () => {
    expect(classifyError(new Error("fetch failed"))).toBe("timeout");
    expect(classifyError(new Error("connect ECONNREFUSED 127.0.0.1:11434"))).toBe("timeout");
  });

  it("falls back to other for anything unrecognized", () => {
    expect(classifyError(new Error("something weird"))).toBe("other");
    expect(classifyError("not even an Error instance")).toBe("other");
  });
});

describe("isRetryableNow", () => {
  it("is true only for 503 and timeout", () => {
    expect(isRetryableNow("503")).toBe(true);
    expect(isRetryableNow("timeout")).toBe(true);
    expect(isRetryableNow("429")).toBe(false);
    expect(isRetryableNow("quota")).toBe(false);
    expect(isRetryableNow("auth")).toBe(false);
    expect(isRetryableNow("invalid_request")).toBe(false);
    expect(isRetryableNow("other")).toBe(false);
  });
});

describe("affectsProviderHealth", () => {
  it("excludes only invalid_request — everything else says something real about the provider", () => {
    expect(affectsProviderHealth("invalid_request")).toBe(false);
    expect(affectsProviderHealth("503")).toBe(true);
    expect(affectsProviderHealth("auth")).toBe(true);
    expect(affectsProviderHealth("timeout")).toBe(true);
    expect(affectsProviderHealth("429")).toBe(true);
    expect(affectsProviderHealth("quota")).toBe(true);
    expect(affectsProviderHealth("other")).toBe(true);
  });
});
