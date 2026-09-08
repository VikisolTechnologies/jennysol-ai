import { describe, it, expect } from "vitest";
import { isIdentityQuestion, CANONICAL_IDENTITY_RESPONSE, JENNYSOL_IDENTITY } from "./identity.js";

describe("identity detection", () => {
  // Exact phrasings required by the product spec, plus the real phrasing
  // observed live in production ("Do u know who created jennysol").
  const shouldDetect = [
    "Who created JennySol?",
    "Who made you?",
    "Who is your founder?",
    "Who developed JennySol?",
    "Who is behind JennySol?",
    "Where was JennySol created?",
    "Do u know who created jennysol",
    "who's your creator",
    "who founded you",
    // First-person phrasing — confirmed live-production miss: a user asking
    // about themselves in third person ("who created me?") still means "who
    // created this assistant," and previously fell through to the model.
    "Who created me?",
    "Who's my creator?",
    "who made me",
  ];

  for (const message of shouldDetect) {
    it(`detects: "${message}"`, () => {
      expect(isIdentityQuestion(message)).toBe(true);
    });
  }

  const shouldNotDetect = [
    "How's weather",
    "Who created the internet?",
    "What's the capital of France",
    "Who is the current Queen of Thailand?",
  ];

  for (const message of shouldNotDetect) {
    it(`does not false-positive on: "${message}"`, () => {
      expect(isIdentityQuestion(message)).toBe(false);
    });
  }

  it("the canonical response contains the required founder/organization facts, nothing invented beyond them", () => {
    expect(CANONICAL_IDENTITY_RESPONSE).toContain(JENNYSOL_IDENTITY.organization);
    expect(CANONICAL_IDENTITY_RESPONSE).toContain(JENNYSOL_IDENTITY.founder);
    expect(CANONICAL_IDENTITY_RESPONSE).toContain("Kishore Seeli");
  });
});
