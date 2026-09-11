import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("./providers/gemini.js", () => ({ geminiProvider: { streamChatCompletion: vi.fn() } }));
vi.mock("./providers/deepseek.js", () => ({ deepseekProvider: { streamChatCompletion: vi.fn() } }));
vi.mock("./providers/ollama.js", () => ({
  ollamaProvider: { streamChatCompletion: vi.fn() },
  isOllamaAvailable: vi.fn(() => false),
}));

import { geminiProvider } from "./providers/gemini.js";
import { deepseekProvider } from "./providers/deepseek.js";
import { isOllamaAvailable } from "./providers/ollama.js";
import { routeChatCompletion, hasAnyConfiguredProvider, getProviderRouteStatus, AllProvidersUnavailableError } from "./modelRouter.js";
import { __resetHealthForTests, recordFailure } from "./providerHealth.js";

function errWithStatus(status: number, message = "err"): Error & { status: number } {
  const e = new Error(message) as Error & { status: number };
  e.status = status;
  return e;
}

function streamsText(text: string) {
  return async (_sp: unknown, _h: unknown, onDelta: (t: string) => void) => {
    onDelta(text);
  };
}

const originalEnv = { ...process.env };

describe("routeChatCompletion", () => {
  beforeEach(() => {
    __resetHealthForTests();
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.LLM_PROVIDER_CHAIN;
    delete process.env.LLM_PROVIDER;
    delete process.env.DEEPSEEK_API_KEY;
    process.env.GEMINI_API_KEY = "test-gemini-key";
    (isOllamaAvailable as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });

  it("uses the single configured provider on the happy path — the pre-router behavior, unchanged", async () => {
    (geminiProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockImplementation(streamsText("hi"));
    const onDelta = vi.fn();

    const result = await routeChatCompletion("sys", [], onDelta);

    expect(result).toMatchObject({ providerUsed: "gemini", fellBack: false });
    expect(onDelta).toHaveBeenCalledWith("hi");
  });

  it("DEPLOYMENT_MODE=local tries Ollama first when no explicit chain is set", async () => {
    process.env.DEPLOYMENT_MODE = "local";
    (isOllamaAvailable as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const { ollamaProvider } = await import("./providers/ollama.js");
    (ollamaProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockImplementation(streamsText("from ollama"));

    const result = await routeChatCompletion("sys", [], vi.fn());
    expect(result.providerUsed).toBe("ollama");
  });

  it("DEPLOYMENT_MODE=cloud (or unset) keeps the plain gemini-first default", async () => {
    process.env.DEPLOYMENT_MODE = "cloud";
    (geminiProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockImplementation(streamsText("from gemini"));

    const result = await routeChatCompletion("sys", [], vi.fn());
    expect(result.providerUsed).toBe("gemini");
  });

  it("falls back to the next provider when the first fails before streaming anything", async () => {
    process.env.LLM_PROVIDER_CHAIN = "gemini,deepseek";
    process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
    (geminiProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockRejectedValue(errWithStatus(503, "high demand"));
    (deepseekProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockImplementation(streamsText("from deepseek"));

    const onDelta = vi.fn();
    const result = await routeChatCompletion("sys", [], onDelta);

    expect(result).toMatchObject({ providerUsed: "deepseek", fellBack: true });
    expect(onDelta).toHaveBeenCalledWith("from deepseek");
  });

  it("does NOT fall back once a provider has already streamed part of a reply", async () => {
    process.env.LLM_PROVIDER_CHAIN = "gemini,deepseek";
    process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
    (geminiProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockImplementation(
      async (_sp: unknown, _h: unknown, onDelta: (t: string) => void) => {
        onDelta("partial answer");
        throw errWithStatus(503, "died mid-stream");
      }
    );

    const onDelta = vi.fn();
    await expect(routeChatCompletion("sys", [], onDelta)).rejects.toThrow();

    expect(onDelta).toHaveBeenCalledWith("partial answer");
    expect(deepseekProvider.streamChatCompletion).not.toHaveBeenCalled();
  });

  it("skips a provider with no credentials configured, without even attempting it", async () => {
    process.env.LLM_PROVIDER_CHAIN = "deepseek,gemini";
    // DEEPSEEK_API_KEY intentionally left unset
    (geminiProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockImplementation(streamsText("gemini answer"));

    const result = await routeChatCompletion("sys", [], vi.fn());

    expect(result.providerUsed).toBe("gemini");
    expect(deepseekProvider.streamChatCompletion).not.toHaveBeenCalled();
  });

  it("skips a provider whose circuit breaker is already tripped", async () => {
    process.env.LLM_PROVIDER_CHAIN = "gemini,deepseek";
    process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
    recordFailure("gemini", "503");
    recordFailure("gemini", "503");
    recordFailure("gemini", "503"); // trips the breaker
    (deepseekProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockImplementation(streamsText("ok"));

    const result = await routeChatCompletion("sys", [], vi.fn());

    expect(result.providerUsed).toBe("deepseek");
    expect(geminiProvider.streamChatCompletion).not.toHaveBeenCalled();
  });

  it("throws AllProvidersUnavailableError when every provider in the chain fails", async () => {
    process.env.LLM_PROVIDER_CHAIN = "gemini,deepseek";
    process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
    (geminiProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockRejectedValue(errWithStatus(503));
    (deepseekProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockRejectedValue(errWithStatus(503));

    await expect(routeChatCompletion("sys", [], vi.fn())).rejects.toBeInstanceOf(AllProvidersUnavailableError);
  });

  it("throws AllProvidersUnavailableError immediately when nothing in the chain is configured", async () => {
    delete process.env.GEMINI_API_KEY;

    await expect(routeChatCompletion("sys", [], vi.fn())).rejects.toBeInstanceOf(AllProvidersUnavailableError);
    expect(geminiProvider.streamChatCompletion).not.toHaveBeenCalled();
  });

  it("an auth failure takes the provider out of rotation for later requests too, not just this one", async () => {
    process.env.LLM_PROVIDER_CHAIN = "gemini,deepseek";
    process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
    (geminiProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockRejectedValue(errWithStatus(401, "invalid API key"));
    (deepseekProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockImplementation(streamsText("ok"));

    const first = await routeChatCompletion("sys", [], vi.fn());
    expect(first.providerUsed).toBe("deepseek");

    (geminiProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockClear();
    const second = await routeChatCompletion("sys", [], vi.fn());
    expect(second.providerUsed).toBe("deepseek");
    expect(geminiProvider.streamChatCompletion).not.toHaveBeenCalled(); // still cooling down, not retried
  });

  it("chaos: Gemini down, DeepSeek picks up every request until Gemini recovers", async () => {
    process.env.LLM_PROVIDER_CHAIN = "gemini,deepseek";
    process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
    (geminiProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockRejectedValue(errWithStatus(503));
    (deepseekProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockImplementation(streamsText("ok"));

    for (let i = 0; i < 5; i++) {
      const result = await routeChatCompletion("sys", [], vi.fn());
      expect(result.providerUsed).toBe("deepseek");
    }
  });
});

describe("first-token timeout (aggressive failover)", () => {
  beforeEach(() => {
    __resetHealthForTests();
    vi.clearAllMocks();
    vi.useFakeTimers();
    process.env = { ...originalEnv };
    delete process.env.LLM_PROVIDER_CHAIN;
    delete process.env.LLM_HEDGE_ENABLED;
    process.env.GEMINI_API_KEY = "test-gemini-key";
    (isOllamaAvailable as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives up on a provider that never produces a first token and falls over to the next one", async () => {
    process.env.LLM_PROVIDER_CHAIN = "gemini,deepseek";
    process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
    process.env.LLM_FIRST_TOKEN_TIMEOUT_MS = "15000";
    // Gemini hangs forever (never resolves, never calls onDelta) — simulates
    // a stuck/unresponsive provider rather than one that returns a clean
    // error.
    (geminiProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {})
    );
    (deepseekProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockImplementation(streamsText("ok"));

    const onDelta = vi.fn();
    const resultPromise = routeChatCompletion("sys", [], onDelta);

    await vi.advanceTimersByTimeAsync(15_001);
    const result = await resultPromise;

    expect(result.providerUsed).toBe("deepseek");
    expect(result.fellBack).toBe(true);
    expect(onDelta).toHaveBeenCalledWith("ok");
  });

  it("aborts the hung provider's signal once the timeout fires", async () => {
    process.env.LLM_FIRST_TOKEN_TIMEOUT_MS = "15000";
    let capturedSignal: AbortSignal | undefined;
    (geminiProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockImplementation(
      (_sp, _h, _onDelta, _onWebSources, opts) => {
        capturedSignal = opts?.signal;
        return new Promise(() => {});
      }
    );

    const resultPromise = routeChatCompletion("sys", [], vi.fn());
    // Attached immediately so fake-timer advancement below can't settle the
    // rejection before a handler exists (a transient, harmless
    // PromiseRejectionHandledWarning otherwise) — the real assertion is the
    // awaited expect() on the next line.
    resultPromise.catch(() => {});
    await vi.advanceTimersByTimeAsync(15_001);
    await expect(resultPromise).rejects.toBeInstanceOf(AllProvidersUnavailableError);

    expect(capturedSignal?.aborted).toBe(true);
  });

  it("does not time out a provider that's actively streaming — only silence counts", async () => {
    process.env.LLM_FIRST_TOKEN_TIMEOUT_MS = "1000";
    (geminiProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockImplementation(
      async (_sp, _h, onDelta: (t: string) => void) => {
        onDelta("first token arrives fast");
        // Then the provider keeps the connection open, streaming slowly,
        // for far longer than the first-token timeout — that's fine, the
        // clock only ever bounded silence before the first token.
        await new Promise((r) => setTimeout(r, 5000));
        onDelta(" and finishes late");
      }
    );

    const onDelta = vi.fn();
    const resultPromise = routeChatCompletion("sys", [], onDelta);
    await vi.advanceTimersByTimeAsync(5001);
    const result = await resultPromise;

    expect(result.providerUsed).toBe("gemini");
    expect(onDelta).toHaveBeenCalledWith(" and finishes late");
  });

  it("does NOT trip the circuit breaker on a timeout when there's no fallback to move to", async () => {
    // Single-provider chain (today's actual production config) — three
    // consecutive first-token timeouts would normally trip the breaker
    // (CONSECUTIVE_FAILURES_TO_TRIP = 3) and lock out the only provider for
    // 30s. Found live against real Gemini: this is a strictly worse outcome
    // than not timing out at all, since a merely-slow-but-would-have-
    // succeeded request gets turned into "completely down" with nothing to
    // fail over to. See modelRouter.ts's routeChatCompletion catch block.
    process.env.LLM_FIRST_TOKEN_TIMEOUT_MS = "1000";
    (geminiProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {})
    );

    for (let i = 0; i < 3; i++) {
      const p = routeChatCompletion("sys", [], vi.fn());
      p.catch(() => {});
      await vi.advanceTimersByTimeAsync(1001);
      await expect(p).rejects.toBeInstanceOf(AllProvidersUnavailableError);
    }

    // A 4th attempt should still actually try Gemini (not skip it as
    // "in cooldown") — proving the breaker never tripped.
    (geminiProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockImplementation(streamsText("recovered"));
    const onDelta = vi.fn();
    const result = await routeChatCompletion("sys", [], onDelta);
    expect(result.providerUsed).toBe("gemini");
    expect(onDelta).toHaveBeenCalledWith("recovered");
  });

  it("DOES trip the circuit breaker on a timeout when a healthy fallback exists", async () => {
    process.env.LLM_PROVIDER_CHAIN = "gemini,deepseek";
    process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
    process.env.LLM_FIRST_TOKEN_TIMEOUT_MS = "1000";
    (geminiProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {})
    );
    (deepseekProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockImplementation(streamsText("ok"));

    for (let i = 0; i < 3; i++) {
      const resultPromise = routeChatCompletion("sys", [], vi.fn());
      await vi.advanceTimersByTimeAsync(1001);
      await resultPromise; // falls back to deepseek each time, doesn't throw
    }

    (deepseekProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockClear();
    const result = await routeChatCompletion("sys", [], vi.fn());
    expect(result.providerUsed).toBe("deepseek");
    // Gemini should be skipped as "in cooldown" now, not attempted again —
    // proving the breaker DID trip once a fallback made that the right call.
    expect(geminiProvider.streamChatCompletion).toHaveBeenCalledTimes(3);
  });

  it("gives a fallback entry the shorter LLM_FALLBACK_FIRST_TOKEN_TIMEOUT_MS, not the primary's budget", async () => {
    // Serializing full-length timeouts across every entry in the chain
    // (15s + 15s + 15s before a user sees anything) would make a real
    // outage feel far worse than it needs to — see modelRouter.ts's
    // firstTokenTimeoutMs(). The primary gets the full budget; a fallback
    // (plain chat, no grounding-tool overhead) is held to a tighter one.
    process.env.LLM_PROVIDER_CHAIN = "gemini,deepseek";
    process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
    process.env.LLM_FIRST_TOKEN_TIMEOUT_MS = "10000";
    process.env.LLM_FALLBACK_FIRST_TOKEN_TIMEOUT_MS = "3000";
    (geminiProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {})
    );
    (deepseekProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {})
    );

    const resultPromise = routeChatCompletion("sys", [], vi.fn());
    resultPromise.catch(() => {});

    // Gemini's own (longer) budget hasn't elapsed yet — still waiting on it,
    // not yet even attempting deepseek.
    await vi.advanceTimersByTimeAsync(9999);
    expect(deepseekProvider.streamChatCompletion).not.toHaveBeenCalled();

    // Gemini's budget elapses; deepseek starts, but its own (shorter)
    // budget elapses too, well before what would have been Gemini's full
    // 10s if it had been applied a second time.
    await vi.advanceTimersByTimeAsync(1 + 3000);
    await expect(resultPromise).rejects.toBeInstanceOf(AllProvidersUnavailableError);
    expect(deepseekProvider.streamChatCompletion).toHaveBeenCalledTimes(1);
  });
});

describe("run-scoped cancellation", () => {
  beforeEach(() => {
    __resetHealthForTests();
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.LLM_PROVIDER_CHAIN;
    process.env.GEMINI_API_KEY = "test-gemini-key";
    process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
    process.env.LLM_PROVIDER_CHAIN = "gemini,deepseek";
    (isOllamaAvailable as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });

  it("rejects with code 'cancelled' and never tries the fallback provider", async () => {
    const controller = new AbortController();
    (geminiProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => {}));

    const resultPromise = routeChatCompletion("sys", [], vi.fn(), undefined, "general", controller.signal);
    resultPromise.catch(() => {});
    controller.abort();

    await expect(resultPromise).rejects.toMatchObject({ code: "cancelled" });
    expect(deepseekProvider.streamChatCompletion).not.toHaveBeenCalled();
  });

  it("does not count against the cancelled provider's health", async () => {
    const controller = new AbortController();
    (geminiProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => {}));

    const resultPromise = routeChatCompletion("sys", [], vi.fn(), undefined, "general", controller.signal);
    resultPromise.catch(() => {});
    controller.abort();
    await resultPromise.catch(() => {});

    // A healthy follow-up request still tries Gemini first — proving
    // cancellation never tripped its circuit breaker.
    (geminiProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockImplementation(streamsText("back to normal"));
    const onDelta = vi.fn();
    const result = await routeChatCompletion("sys", [], onDelta);
    expect(result.providerUsed).toBe("gemini");
    expect(onDelta).toHaveBeenCalledWith("back to normal");
  });

  it("rejecting an already-aborted signal at call time also short-circuits immediately", async () => {
    const controller = new AbortController();
    controller.abort();
    (geminiProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => {}));

    const resultPromise = routeChatCompletion("sys", [], vi.fn(), undefined, "general", controller.signal);
    await expect(resultPromise).rejects.toMatchObject({ code: "cancelled" });
    expect(deepseekProvider.streamChatCompletion).not.toHaveBeenCalled();
  });
});

describe("hedging (LLM_HEDGE_ENABLED)", () => {
  beforeEach(() => {
    __resetHealthForTests();
    vi.clearAllMocks();
    vi.useFakeTimers();
    process.env = { ...originalEnv };
    process.env.LLM_PROVIDER_CHAIN = "gemini,deepseek";
    process.env.GEMINI_API_KEY = "test-gemini-key";
    process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
    process.env.LLM_HEDGE_ENABLED = "true";
    process.env.LLM_HEDGE_DELAY_MS = "700";
    (isOllamaAvailable as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not start the fallback when the primary responds before the hedge delay", async () => {
    (geminiProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockImplementation(streamsText("fast primary"));
    (deepseekProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockImplementation(streamsText("should not run"));

    const onDelta = vi.fn();
    const result = await routeChatCompletion("sys", [], onDelta);

    expect(result).toMatchObject({ providerUsed: "gemini", hedged: false });
    expect(onDelta).toHaveBeenCalledWith("fast primary");
    expect(deepseekProvider.streamChatCompletion).not.toHaveBeenCalled();
  });

  it("starts the fallback after the hedge delay when the primary is slow, and uses whichever answers first", async () => {
    (geminiProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockImplementation(
      async (_sp, _h, onDelta: (t: string) => void) => {
        await new Promise((r) => setTimeout(r, 3000)); // slower than the 700ms hedge delay
        onDelta("slow primary");
      }
    );
    (deepseekProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockImplementation(streamsText("fast fallback"));

    const onDelta = vi.fn();
    const resultPromise = routeChatCompletion("sys", [], onDelta);
    await vi.advanceTimersByTimeAsync(701);
    const result = await resultPromise;

    expect(result).toMatchObject({ providerUsed: "deepseek", hedged: true });
    expect(onDelta).toHaveBeenCalledWith("fast fallback");
    expect(onDelta).not.toHaveBeenCalledWith("slow primary");
  });

  it("is a no-op when only one provider is configured — nothing to hedge against", async () => {
    delete process.env.DEEPSEEK_API_KEY;
    (geminiProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockImplementation(streamsText("solo"));

    const result = await routeChatCompletion("sys", [], vi.fn());

    expect(result).toMatchObject({ providerUsed: "gemini", hedged: false });
  });
});

// M6 (Arena connector gateway): proves routeChatCompletion — the function every real caller
// (chatRunner.ts, the new agent gateway) actually uses — threads tools/onToolCall through to the
// provider, closing the gap M1's own tests didn't cover (they called geminiProvider directly).
describe("routeChatCompletion — tool calling (M6)", () => {
  beforeEach(() => {
    __resetHealthForTests();
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.LLM_PROVIDER_CHAIN;
    delete process.env.LLM_PROVIDER;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.LLM_HEDGE_ENABLED;
    process.env.GEMINI_API_KEY = "test-gemini-key";
    (isOllamaAvailable as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });

  it("passes tools and onToolCall through to the provider's streamChatCompletion call", async () => {
    (geminiProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockImplementation(streamsText("ok"));
    const tools = [{ name: "test.tool", description: "d", parameters: {} }];
    const onToolCall = vi.fn();

    await routeChatCompletion("sys", [], vi.fn(), undefined, "general", undefined, tools, onToolCall);

    const optsArg = (geminiProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mock.calls[0][4];
    expect(optsArg.tools).toBe(tools);
    expect(optsArg.onToolCall).toBe(onToolCall);
  });

  it("skips the hedge path entirely for a tool-bearing request, even when hedging is enabled", async () => {
    process.env.LLM_HEDGE_ENABLED = "true";
    process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
    (geminiProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockImplementation(streamsText("primary answer"));

    const result = await routeChatCompletion(
      "sys",
      [],
      vi.fn(),
      undefined,
      "general",
      undefined,
      [{ name: "test.tool", description: "d", parameters: {} }],
      vi.fn()
    );

    // hedged:false and no interaction with deepseek at all proves the sequential
    // attemptWithTimeout path ran, not runHedgedPair (which never learned to carry tools).
    expect(result).toMatchObject({ providerUsed: "gemini", hedged: false });
    expect(deepseekProvider.streamChatCompletion).not.toHaveBeenCalled();
  });

  it("a request with no tools still hedges normally — the skip is tool-specific, not a regression", async () => {
    process.env.LLM_HEDGE_ENABLED = "true";
    process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
    (geminiProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockImplementation(streamsText("primary answer"));

    const result = await routeChatCompletion("sys", [], vi.fn());

    expect(result).toMatchObject({ providerUsed: "gemini" });
  });
});

describe("hasAnyConfiguredProvider", () => {
  beforeEach(() => {
    __resetHealthForTests();
    process.env = { ...originalEnv };
    delete process.env.GEMINI_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    (isOllamaAvailable as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });

  it("is false when nothing in the chain has credentials or reachability", () => {
    expect(hasAnyConfiguredProvider()).toBe(false);
  });

  it("is true as soon as any one provider is configured", () => {
    process.env.GEMINI_API_KEY = "key";
    expect(hasAnyConfiguredProvider()).toBe(true);
  });
});

// Admin-only diagnostics (routes/admin.ts's /provider-health) reads this
// directly — real regression coverage for exactly the shape that endpoint
// exposes, including that a provider outside the active chain is still
// reported (not silently dropped) so an operator can see *why* it's unused.
describe("getProviderRouteStatus", () => {
  beforeEach(() => {
    __resetHealthForTests();
    process.env = { ...originalEnv };
    delete process.env.LLM_PROVIDER_CHAIN;
    delete process.env.LLM_PROVIDER;
    delete process.env.DEEPSEEK_API_KEY;
    process.env.GEMINI_API_KEY = "test-gemini-key";
    (isOllamaAvailable as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });

  it("reports every registered provider, not just the ones in the active chain", () => {
    const status = getProviderRouteStatus();
    expect(status.map((s) => s.name).sort()).toEqual(["deepseek", "gemini", "ollama"]);
  });

  it("marks only the default chain's entries as in the active chain", () => {
    const status = getProviderRouteStatus();
    const byName = Object.fromEntries(status.map((s) => [s.name, s]));
    expect(byName.gemini.inActiveChain).toBe(true);
    // Default chain (no LLM_PROVIDER_CHAIN, DEPLOYMENT_MODE!=local) is just ["gemini"].
    expect(byName.deepseek.inActiveChain).toBe(false);
    expect(byName.ollama.inActiveChain).toBe(false);
  });

  it("reflects configured vs. usable independently (a configured-but-unhealthy provider)", () => {
    recordFailure("gemini", "auth");
    const status = getProviderRouteStatus();
    const gemini = status.find((s) => s.name === "gemini")!;
    expect(gemini.configured).toBe(true);
    expect(gemini.usable).toBe(false);
  });

  it("respects an explicit LLM_PROVIDER_CHAIN", () => {
    process.env.LLM_PROVIDER_CHAIN = "ollama,gemini";
    const status = getProviderRouteStatus();
    const byName = Object.fromEntries(status.map((s) => [s.name, s]));
    expect(byName.ollama.inActiveChain).toBe(true);
    expect(byName.gemini.inActiveChain).toBe(true);
    expect(byName.deepseek.inActiveChain).toBe(false);
  });
});
