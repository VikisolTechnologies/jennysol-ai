import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("./search/searchRouter.js", () => ({ hasAnySearchProviderConfigured: vi.fn(() => false) }));
vi.mock("./imageRouter.js", () => ({ hasWorkingImageProvider: vi.fn(() => false) }));

import { hasAnySearchProviderConfigured } from "./search/searchRouter.js";
import { hasWorkingImageProvider } from "./imageRouter.js";
import { buildSystemPrompt } from "./llm.js";

const mocked = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;
const empty = { documentChunks: [], webChunks: [] };

describe("buildSystemPrompt capabilities", () => {
  beforeEach(() => {
    mocked(hasAnySearchProviderConfigured).mockReturnValue(false);
    mocked(hasWorkingImageProvider).mockReturnValue(false);
  });

  it("always tells the model it has voice and documents and is not text-only", () => {
    const prompt = buildSystemPrompt(empty);
    expect(prompt).toMatch(/never say you're "text-only"/);
    expect(prompt).toMatch(/microphone/);
    expect(prompt).toMatch(/upload files in the sidebar/);
  });

  it("only claims web lookups and image generation when they're actually configured", () => {
    let prompt = buildSystemPrompt(empty);
    expect(prompt).not.toMatch(/looks it up on the\s+web/);
    expect(prompt).not.toMatch(/JennySol generates images/);

    mocked(hasAnySearchProviderConfigured).mockReturnValue(true);
    mocked(hasWorkingImageProvider).mockReturnValue(true);
    prompt = buildSystemPrompt(empty);
    expect(prompt).toMatch(/looks it up on the\s+web/);
    expect(prompt).toMatch(/JennySol generates images/);
    expect(prompt).toMatch(/picture icon/);
  });

  it("says images aren't available yet, without recommending other apps, when no working image provider exists", () => {
    const prompt = buildSystemPrompt(empty);
    expect(prompt).toMatch(/image generation isn't available yet/);
    expect(prompt).toMatch(/don't recommend other AI image\s+apps/);
  });

  it("no longer asks for an upload-documents reminder on every turn", () => {
    expect(buildSystemPrompt(empty)).not.toMatch(/mention once/i);
  });

  it("still includes document context when there is some", () => {
    const prompt = buildSystemPrompt({ documentChunks: ["alpha"], webChunks: [] });
    expect(prompt).toContain("DOCUMENT CONTEXT:");
    expect(prompt).toContain("[1] alpha");
  });
});
