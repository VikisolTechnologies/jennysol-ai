import { describe, it, expect } from "vitest";
import { needsCurrentInfo } from "./currentInfo.js";

describe("needsCurrentInfo", () => {
  const shouldTrigger = [
    "What's the weather today?",
    "Latest AI news",
    "What is the current price of RTX 5060 Ti 16GB in India?",
    "Who is the current Prime Minister of India?",
    "Who won yesterday?",
    // Status-check phrasings — confirmed gap: these have no explicit
    // "today"/"latest"/"current" keyword but are still current-info
    // questions whose true answer can change over time.
    "Is Queen Sirikit alive?",
    "Is she still alive?",
    "Is he still in office?",
    // Explicit search requests — confirmed live-production gap:
    // "Can u search about her on google" previously matched nothing at
    // all, so no search/grounding was ever attempted for it.
    "Can u search about her on google",
    "Could you search for the latest iPhone specs",
    "Please google this for me",
    "Look that up online",
  ];

  for (const message of shouldTrigger) {
    it(`triggers on: "${message}"`, () => {
      expect(needsCurrentInfo(message)).toBe(true);
    });
  }

  const shouldNotTrigger = [
    "Write a Python function to reverse a string",
    "What's 2 + 2?",
    "Tell me a joke",
    "Who created JennySol?",
  ];

  for (const message of shouldNotTrigger) {
    it(`does not trigger on: "${message}"`, () => {
      expect(needsCurrentInfo(message)).toBe(false);
    });
  }
});
