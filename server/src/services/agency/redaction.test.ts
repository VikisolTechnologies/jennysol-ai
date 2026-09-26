import { describe, it, expect } from "vitest";
import { redactJd } from "./redaction.js";

describe("redactJd", () => {
  it("redacts an email, a phone number, and a URL", () => {
    const result = redactJd(
      "Contact us at hr@northstar-example.com or call +91 98765 43210. See https://northstar-example.com/careers for more."
    );
    expect(result.ok).toBe(true);
    expect(result.redacted).not.toContain("hr@northstar-example.com");
    expect(result.redacted).not.toContain("98765 43210");
    expect(result.redacted).not.toContain("https://northstar-example.com/careers");
    expect(result.redacted).toContain("[REDACTED EMAIL]");
    expect(result.redacted).toContain("[REDACTED PHONE]");
    expect(result.redacted).toContain("[REDACTED URL]");
  });

  it("redacts the client name from a **Company:** line and every later mention of it", () => {
    const result = redactJd(
      "**Company:** Northstar Commerce Technologies\n\nNorthstar Commerce Technologies is hiring a backend engineer."
    );
    expect(result.redacted).not.toContain("Northstar Commerce Technologies");
    expect(result.redacted.match(/\[REDACTED CLIENT NAME\]/g)).toHaveLength(2);
    expect(result.removed).toContainEqual({ type: "company_name", count: 2 });
  });

  it("does not false-positive on ordinary JD numeric ranges (experience years, compensation)", () => {
    const result = redactJd("Experience: 3-5 years. Compensation: 22-30 lakh per annum.");
    expect(result.ok).toBe(true);
    expect(result.removed.find((r) => r.type === "phone")).toBeUndefined();
    expect(result.redacted).toContain("3-5 years");
    expect(result.redacted).toContain("22-30 lakh");
  });

  it("a JD with nothing to redact passes through unchanged and ok", () => {
    const jd = "Role: Backend Engineer. Must-have: Java, Postgres.";
    const result = redactJd(jd);
    expect(result.ok).toBe(true);
    expect(result.redacted).toBe(jd);
    expect(result.removed).toEqual([]);
  });

  it("fails closed on a real gap in the redaction pass: a bare domain with no http(s)/www prefix", () => {
    // URL_RE (the redaction pass) only strips http(s):// or www.-prefixed URLs. A bare domain
    // mentioned mid-sentence ("see northstar-example.com for details") survives the redaction
    // pass untouched -- this proves the verification check is a real, independent re-scan, not a
    // tautological re-run of the same pattern the redaction pass already used.
    const result = redactJd("For more information, see northstar-example.com for details.");
    expect(result.redacted).toContain("northstar-example.com"); // the redaction pass really did miss it
    expect(result.ok).toBe(false); // but the fail-closed check catches it and refuses the result
  });

  it("is stateless across repeated calls (module-level regex reuse can't leak lastIndex)", () => {
    const first = redactJd("Email hidden.leftover1@example.com here.");
    const second = redactJd("Email hidden.leftover2@example.com here.");
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.redacted).not.toContain("leftover2@example.com");
  });
});
