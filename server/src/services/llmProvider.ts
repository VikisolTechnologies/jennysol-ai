export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface WebSource {
  title: string;
  url: string;
  domain?: string;
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
