import { describe, it, expect } from "vitest";
import { classifyDifficulty } from "./modelTiers.js";

describe("classifyDifficulty", () => {
  it("everyday requests go to the fast tier", () => {
    expect(classifyDifficulty("any badminton games tonight?")).toBe("fast");
    expect(classifyDifficulty("show me react jobs")).toBe("fast");
    expect(classifyDifficulty("hi")).toBe("fast");
  });

  it("judgement or drafting goes to balanced", () => {
    expect(classifyDifficulty("which of these jobs is better for me?")).toBe("balanced");
    expect(classifyDifficulty("draft a post asking for a good plumber")).toBe("balanced");
    expect(classifyDifficulty("find a cricket game and join it")).toBe("balanced"); // two kinds of action
  });

  it("planning or several actions goes to deep", () => {
    expect(classifyDifficulty("plan a basketball game this saturday and invite people")).toBe("deep");
    expect(classifyDifficulty("find a react job, apply, and post in careers asking for referrals")).toBe("deep");
    expect(classifyDifficulty("x".repeat(401))).toBe("deep");
  });

  it("a long conversation nudges up to balanced", () => {
    expect(classifyDifficulty("ok", 8)).toBe("balanced");
  });
});
