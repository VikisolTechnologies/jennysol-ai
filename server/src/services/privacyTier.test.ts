import { describe, it, expect, afterEach } from "vitest";
import { applyPrivacyTier, privacyEnforced } from "./privacyTier.js";

describe("privacy tiers", () => {
  afterEach(() => {
    delete process.env.PRIVACY_TIER_ENFORCE;
  });

  it("shadow mode keeps the cloud providers and records that they would be refused", () => {
    const decision = applyPrivacyTier("PRIVATE", ["gemini", "ollama"]);
    expect(privacyEnforced()).toBe(false);
    expect(decision.names).toEqual(["gemini", "ollama"]);
    expect(decision.rejected).toEqual(["gemini"]);
  });

  it("enforced PRIVATE keeps only Ollama", () => {
    process.env.PRIVACY_TIER_ENFORCE = "true";
    expect(applyPrivacyTier("PRIVATE", ["gemini", "ollama"])).toEqual({
      names: ["ollama"],
      rejected: ["gemini"],
    });
  });

  it("PUBLIC_CLOUD refuses nobody", () => {
    process.env.PRIVACY_TIER_ENFORCE = "true";
    expect(applyPrivacyTier("PUBLIC_CLOUD", ["gemini", "ollama"]).rejected).toEqual([]);
  });
});
