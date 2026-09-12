export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface WebSource {
  title: string;
  url: string;
  domain?: string;
  publishedAt?: string;
  provider?: string;
  sourceType?: string;
  freshness?: string;
}

// M1 (tool-calling engine, PROJECT-PROGRESS.md milestone model): a provider-agnostic
// description of a callable tool. `parameters` is plain JSON Schema, not a provider-specific
// schema format — each provider implementation translates it to whatever its own SDK expects
// (e.g. Gemini's `parametersJsonSchema`), so nothing above this interface needs to know which
// provider is actually answering. Deliberately generic: this file has no knowledge of Arena,
// or of any other product — see ADR-002 in docs/architecture/ for why that separation matters.
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

// What a provider hands back when the model decides to call a tool mid-generation.
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

// The caller executes the actual tool (whatever that means — a test fixture today, a real
// Arena API call once ADR-002/ADR-003's connector and identity layers exist) and returns a
// JSON-serializable result, which the provider feeds back to the model for a final answer.
// A thrown error is caught by the provider and reported to the model as a tool error rather
// than crashing the turn — the model can then explain the failure to the user.
export type ToolCallHandler = (call: ToolCall) => Promise<unknown>;

// Real counts where a provider's API reports them — confirmed live against
// Ollama 0.33.3's /v1/chat/completions (stream_options.include_usage works
// correctly there too, arriving in a final chunk after generation finishes;
// a "thinking"-mode model like qwen3 can take a while to reach it, so don't
// mistake a request that timed out before [DONE] for the field not
// existing — an early test here made exactly that mistake). Estimated
// (character count / 4) only as a genuine fallback, e.g. a request that
// errors before any usage chunk arrives.
export interface TokenUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  estimated: boolean;
}

export interface StreamOptions {
  // Lets the router give up on a provider that isn't producing a first token
  // fast enough (aggressive failover) or that lost a hedge race, without
  // waiting for it to finish on its own. Every provider wires this into its
  // own transport (fetch's own `signal`, or the SDK's `abortSignal`).
  signal?: AbortSignal;
  // Per-request model override — only Ollama reads this today (see
  // providers/ollama.ts): the router resolves a task-appropriate model from
  // modelRegistry.ts (coding vs. general vs. reasoning) and passes it here
  // rather than Ollama always using one fixed OLLAMA_MODEL env var. Cloud
  // providers ignore it; each already has its own fixed configured model.
  model?: string;
  // M1: when both `tools` and `onToolCall` are set, a provider that supports real
  // model-directed function calling (Gemini today — see providers/gemini.ts) may invoke one
  // instead of only answering from its own knowledge or the existing search/RAG context
  // injection. Not passed on any real production chat request yet — this is deliberately
  // opt-in machinery, proven against a fake/test tool before any product (Arena or otherwise)
  // registers a real one (M2-M6). A provider that doesn't implement tool calling simply
  // ignores these fields and answers normally, same pattern already used for `onWebSources`.
  tools?: ToolDefinition[];
  onToolCall?: ToolCallHandler;
  // Fired once, after generation finishes, if the provider has anything to report.
  onUsage?: (usage: TokenUsage) => void;
}

export interface LlmProvider {
  streamChatCompletion(
    systemPrompt: string,
    history: ChatTurn[],
    onDelta: (text: string) => void,
    // Only Gemini implements this today (native Google Search grounding).
    // Other providers simply never call it — real sources or none, never fabricated.
    onWebSources?: (sources: WebSource[]) => void,
    opts?: StreamOptions
  ): Promise<void>;
}
