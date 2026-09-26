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

// ADR-007 §2/§5: CONTROLLED_CLOUD reaches ONLY the paid Gemini adapter — never Ollama, never any
// other configured cloud provider.
describe("privacy tiers — CONTROLLED_CLOUD (ADR-007)", () => {
  afterEach(() => {
    delete process.env.PRIVACY_TIER_ENFORCE;
  });

  it("shadow mode keeps the full chain but records what CONTROLLED_CLOUD would refuse", () => {
    const decision = applyPrivacyTier("CONTROLLED_CLOUD", ["gemini", "ollama", "anthropic"]);
    expect(decision.names).toEqual(["gemini", "ollama", "anthropic"]);
    expect(decision.rejected.sort()).toEqual(["anthropic", "ollama"]);
  });

  it("enforced CONTROLLED_CLOUD keeps only gemini — not ollama, not any other cloud adapter", () => {
    process.env.PRIVACY_TIER_ENFORCE = "true";
    expect(applyPrivacyTier("CONTROLLED_CLOUD", ["gemini", "ollama", "anthropic"])).toEqual({
      names: ["gemini"],
      rejected: ["ollama", "anthropic"],
    });
  });

  it("test 9(a): Class A (PRIVATE) never resolves to a cloud adapter under forced enforcement, whatever the global flag is", () => {
    expect(applyPrivacyTier("PRIVATE", ["gemini", "anthropic", "ollama"], { forceEnforce: true }).names).toEqual([
      "ollama",
    ]);
  });

  it("test 9(a) variant: CONTROLLED_CLOUD never resolves to Ollama or a non-paid-Gemini adapter under forced enforcement", () => {
    expect(
      applyPrivacyTier("CONTROLLED_CLOUD", ["ollama", "anthropic", "gemini"], { forceEnforce: true }).names
    ).toEqual(["gemini"]);
  });

  it("forceEnforce applies even when the global watch-only flag is unset — an agency tenant is never in shadow mode", () => {
    expect(privacyEnforced()).toBe(false);
    expect(applyPrivacyTier("PRIVATE", ["gemini", "ollama"], { forceEnforce: true }).names).toEqual(["ollama"]);
  });

  it("the global flag alone still enforces exactly as before — forceEnforce is additive, not a replacement", () => {
    process.env.PRIVACY_TIER_ENFORCE = "true";
    expect(applyPrivacyTier("PRIVATE", ["gemini", "ollama"]).names).toEqual(["ollama"]);
  });
});
