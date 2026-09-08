import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { isHealthy, recordSuccess, recordFailure, getHealthSnapshot, __resetHealthForTests } from "./providerHealth.js";

describe("providerHealth circuit breaker", () => {
  beforeEach(() => {
    __resetHealthForTests();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts healthy for a provider that's never been seen", () => {
    expect(isHealthy("gemini")).toBe(true);
  });

  it("stays healthy through one or two transient failures", () => {
    recordFailure("gemini", "503");
    expect(isHealthy("gemini")).toBe(true);
    recordFailure("gemini", "503");
    expect(isHealthy("gemini")).toBe(true);
  });

  it("trips the breaker after three consecutive transient failures", () => {
    recordFailure("gemini", "503");
    recordFailure("gemini", "503");
    recordFailure("gemini", "503");
    expect(isHealthy("gemini")).toBe(false);
  });

  it("recovers automatically (half-open) once the cooldown elapses", () => {
    recordFailure("gemini", "503");
    recordFailure("gemini", "503");
    recordFailure("gemini", "503");
    expect(isHealthy("gemini")).toBe(false);

    vi.advanceTimersByTime(30_001);
    expect(isHealthy("gemini")).toBe(true);
  });

  it("a success resets the consecutive-failure count", () => {
    recordFailure("gemini", "503");
    recordFailure("gemini", "503");
    recordSuccess("gemini");
    recordFailure("gemini", "503");
    recordFailure("gemini", "503");
    // Only 2 consecutive since the reset — still under the trip threshold.
    expect(isHealthy("gemini")).toBe(true);
  });

  it("trips on a single auth failure, not three", () => {
    recordFailure("deepseek", "auth");
    expect(isHealthy("deepseek")).toBe(false);
  });

  it("keeps an auth failure cooled down well past the transient window", () => {
    recordFailure("deepseek", "auth");
    vi.advanceTimersByTime(30_001); // past the transient cooldown
    expect(isHealthy("deepseek")).toBe(false); // but not past the auth one
  });

  it("tracks providers independently", () => {
    recordFailure("gemini", "503");
    recordFailure("gemini", "503");
    recordFailure("gemini", "503");
    expect(isHealthy("gemini")).toBe(false);
    expect(isHealthy("deepseek")).toBe(true);
  });

  it("snapshot reflects counts and health per provider", () => {
    recordSuccess("gemini");
    recordFailure("gemini", "503");
    const snap = getHealthSnapshot();
    expect(snap.gemini.successCount).toBe(1);
    expect(snap.gemini.count503).toBe(1);
    expect(snap.gemini.healthy).toBe(true);
  });
});
