import { describe, it, expect } from "vitest";
import { jennysolConnector } from "./jennysol.js";
import type { ProductIdentity } from "../productIdentity.js";

const identity: ProductIdentity = { product: "jennysol", externalUserId: "u1", scope: [] };

describe("jennysolConnector — jennysol.draftAgencyScorecard", () => {
  it("is registered as a low-risk READ tool", () => {
    const tool = jennysolConnector.getTools().find((t) => t.name === "jennysol.draftAgencyScorecard");
    expect(tool).toBeDefined();
    expect(tool?.tier).toBe("READ");
    expect(tool?.risk).toBe("low");
  });

  it("drafts a scorecard from a pasted requirement and always defers to the recruiter", async () => {
    const tool = jennysolConnector.getTools().find((t) => t.name === "jennysol.draftAgencyScorecard")!;
    const result = (await tool.execute(identity, {
      requirement: "Senior Backend Engineer\nMust-have: Node.js, Postgres\nNice-to-have: Kubernetes",
    })) as { role: string; mustHave: string[]; niceToHave: string[]; recruiterDecides: true };

    expect(result.role).toBe("Senior Backend Engineer");
    expect(result.mustHave).toEqual(["Node.js", "Postgres"]);
    expect(result.niceToHave).toEqual(["Kubernetes"]);
    expect(result.recruiterDecides).toBe(true);
  });

  it("rejects an empty requirement rather than drafting a scorecard from nothing", async () => {
    const tool = jennysolConnector.getTools().find((t) => t.name === "jennysol.draftAgencyScorecard")!;
    await expect(tool.execute(identity, { requirement: "  " })).rejects.toThrow(/requirement/);
  });
});
