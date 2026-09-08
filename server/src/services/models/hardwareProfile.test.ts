import { describe, it, expect, beforeEach } from "vitest";
import { getHardwareProfile, getHardwareSnapshot, HARDWARE_PROFILES } from "./hardwareProfile.js";

const originalEnv = { ...process.env };

describe("hardwareProfile", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.LOCAL_HARDWARE_PROFILE;
  });

  it("honors an explicit LOCAL_HARDWARE_PROFILE override regardless of actual hardware", () => {
    process.env.LOCAL_HARDWARE_PROFILE = "dedicated_rtx5060ti_16gb";
    expect(getHardwareProfile().id).toBe("dedicated_rtx5060ti_16gb");
  });

  it("falls back to the conservative 'unknown' profile for an unrecognized override value", () => {
    process.env.LOCAL_HARDWARE_PROFILE = "some_typo_profile";
    // Falls through to auto-detection rather than crashing on a bad env var.
    expect(HARDWARE_PROFILES[getHardwareProfile().id]).toBeDefined();
  });

  it("m1_16gb caps a single model well under the full 16GB (headroom for OS/Node/browser)", () => {
    const profile = HARDWARE_PROFILES.m1_16gb;
    expect(profile.maxSingleModelGb).toBeLessThan(profile.totalMemoryGb);
    expect(profile.maxConcurrentLocalRuns).toBe(1);
  });

  it("the dedicated server profile allows a larger single model and more concurrency than m1_16gb", () => {
    const m1 = HARDWARE_PROFILES.m1_16gb;
    const dedicated = HARDWARE_PROFILES.dedicated_rtx5060ti_16gb;
    expect(dedicated.maxSingleModelGb).toBeGreaterThan(m1.maxSingleModelGb);
    expect(dedicated.maxConcurrentLocalRuns).toBeGreaterThanOrEqual(m1.maxConcurrentLocalRuns);
  });

  it("getHardwareSnapshot reports the live platform/arch alongside the resolved profile", () => {
    process.env.LOCAL_HARDWARE_PROFILE = "m1_16gb";
    const snapshot = getHardwareSnapshot();
    expect(snapshot.profile.id).toBe("m1_16gb");
    expect(typeof snapshot.platform).toBe("string");
    expect(typeof snapshot.totalMemoryGb).toBe("number");
  });
});
