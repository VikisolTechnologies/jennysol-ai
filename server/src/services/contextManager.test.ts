import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("./embeddings.js", () => ({ embed: vi.fn(async () => new Float32Array([1, 0, 0])) }));
vi.mock("./vectorStore.js", () => ({
  searchSimilarChunks: vi.fn(() => []),
  userHasDocuments: vi.fn(() => false),
}));
vi.mock("./conversationStore.js", () => ({
  getConversationSummary: vi.fn(() => ({ summary: "", throughIndex: 0 })),
  saveConversationSummary: vi.fn(),
}));
vi.mock("./modelRouter.js", () => ({
  routeChatCompletion: vi.fn(async (_sp: unknown, _h: unknown, onDelta: (t: string) => void) => {
    onDelta("Summarized.");
    return { providerUsed: "gemini", fellBack: false };
  }),
}));

import { embed } from "./embeddings.js";
import { searchSimilarChunks, userHasDocuments } from "./vectorStore.js";
import { getConversationSummary, saveConversationSummary } from "./conversationStore.js";
import { routeChatCompletion } from "./modelRouter.js";
import { buildContext, summarizeIfNeeded } from "./contextManager.js";
import type { ChatTurn } from "./llmProvider.js";

function turns(n: number): ChatTurn[] {
  return Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: `message ${i}`,
  }));
}

describe("buildContext — bounded history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getConversationSummary as ReturnType<typeof vi.fn>).mockReturnValue({ summary: "", throughIndex: 0 });
    (userHasDocuments as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });

  it("sends the full history unmodified when it's within the recent window", async () => {
    const history = turns(6);
    const ctx = await buildContext("u1", "c1", "next question", history);

    // 6 history turns + the new user turn appended at the end, nothing summarized away
    expect(ctx.turns).toHaveLength(7);
    expect(ctx.turns.slice(0, 6)).toEqual(history);
    expect(ctx.turns[6]).toEqual({ role: "user", content: "next question" });
  });

  it("the FIRST request after crossing the window isn't compressed yet — summarization hasn't run for it", async () => {
    // Honest limitation, not a bug: with no summary stored yet, the entire
    // gap is sent raw (correctness over aggressive compression — see the
    // "never drops content" test below). Compression only kicks in starting
    // with the request *after* summarizeIfNeeded (fired at the end of this
    // request's own turn) has had a chance to run. That's what the next
    // test verifies.
    const long = await buildContext("u1", "c1", "q", turns(200));
    expect(long.turns.length).toBe(201); // 188 raw gap + 12 recent + 1 new — same as unbounded here
  });

  it("stays bounded on every later request once the summary has caught up, no matter how much longer the conversation grows", async () => {
    (getConversationSummary as ReturnType<typeof vi.fn>).mockReturnValue({
      summary: "Running summary.",
      throughIndex: 188,
    });
    const at200 = await buildContext("u1", "c1", "q", turns(200));

    (getConversationSummary as ReturnType<typeof vi.fn>).mockReturnValue({
      summary: "Running summary, now longer.",
      throughIndex: 988,
    });
    const at1000 = await buildContext("u1", "c1", "q", turns(1000));

    // Same shape (2 summary turns + 12-message window + 1 new turn)
    // regardless of whether the underlying conversation has 200 or 1000
    // messages — this is the actual latency-growth fix.
    expect(at200.turns).toHaveLength(15);
    expect(at1000.turns).toHaveLength(15);
  });

  it("once a summary exists and is caught up, bounds strictly to the recent window + summary turns", async () => {
    (getConversationSummary as ReturnType<typeof vi.fn>).mockReturnValue({
      summary: "Earlier the user discussed X and Y.",
      throughIndex: 188, // caught up to exactly (200 - 12)
    });

    const ctx = await buildContext("u1", "c1", "q", turns(200));

    // 2 summary turns + 12-message recent window + 1 new user turn = 15,
    // completely independent of the original 200-message history length.
    expect(ctx.turns).toHaveLength(15);
  });

  it("never drops content — an unsummarized gap is sent raw rather than silently discarded", async () => {
    (getConversationSummary as ReturnType<typeof vi.fn>).mockReturnValue({
      summary: "Old summary.",
      throughIndex: 100, // way behind — summarizer hasn't caught up
    });

    const history = turns(150);
    const ctx = await buildContext("u1", "c1", "q", history);

    // gap = messages[100..138) (150 - 12 = 138), 38 raw messages, plus 2
    // summary turns, plus the 12-message window, plus the new user turn.
    const flatContents = ctx.turns.map((t) => t.content);
    expect(flatContents).toContain("message 100");
    expect(flatContents).toContain("message 137");
  });
});

describe("buildContext — retrieval fast path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getConversationSummary as ReturnType<typeof vi.fn>).mockReturnValue({ summary: "", throughIndex: 0 });
  });

  it("skips embedding entirely for a trivial greeting, even if the user has documents", async () => {
    (userHasDocuments as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const ctx = await buildContext("u1", "c1", "Hi Jenny", []);

    expect(ctx.retrievalSkipped).toBe(true);
    expect(embed).not.toHaveBeenCalled();
    expect(searchSimilarChunks).not.toHaveBeenCalled();
  });

  it("skips embedding for a real question when the user has no documents at all", async () => {
    (userHasDocuments as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const ctx = await buildContext("u1", "c1", "What does section 4 of my contract say?", []);

    expect(ctx.retrievalSkipped).toBe(true);
    expect(embed).not.toHaveBeenCalled();
  });

  it("runs retrieval for a real question when the user does have documents", async () => {
    (userHasDocuments as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const ctx = await buildContext("u1", "c1", "What does section 4 of my contract say?", []);

    expect(ctx.retrievalSkipped).toBe(false);
    expect(embed).toHaveBeenCalledWith("What does section 4 of my contract say?");
    expect(searchSimilarChunks).toHaveBeenCalled();
  });
});

describe("summarizeIfNeeded", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getConversationSummary as ReturnType<typeof vi.fn>).mockReturnValue({ summary: "", throughIndex: 0 });
  });

  it("does nothing for a conversation still within the recent window", () => {
    summarizeIfNeeded("c1", turns(6));
    expect(routeChatCompletion).not.toHaveBeenCalled();
  });

  it("does not re-summarize on every message — only once the unsummarized gap is large enough to batch", () => {
    (getConversationSummary as ReturnType<typeof vi.fn>).mockReturnValue({ summary: "", throughIndex: 2 });
    // olderCount = 15 - 12 = 3; gap = 3 - 2 = 1 — below the default batch threshold of 5
    summarizeIfNeeded("c1", turns(15));
    expect(routeChatCompletion).not.toHaveBeenCalled();
  });

  it("fires a background summarization once the gap crosses the batch threshold, without the caller awaiting completion", async () => {
    (getConversationSummary as ReturnType<typeof vi.fn>).mockReturnValue({ summary: "", throughIndex: 0 });

    // summarizeIfNeeded itself is synchronous (not async, returns no
    // promise) — the request handler that calls it never awaits the actual
    // summarization model call, only kicks it off.
    const returned = summarizeIfNeeded("c1", turns(20)); // olderCount = 8, gap = 8 >= default batch size 5
    expect(returned).toBeUndefined();

    await vi.waitFor(() => expect(routeChatCompletion).toHaveBeenCalled());
    await vi.waitFor(() => expect(saveConversationSummary).toHaveBeenCalledWith("c1", expect.any(String), 8));
  });
});
