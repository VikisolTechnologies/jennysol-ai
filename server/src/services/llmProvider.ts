export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface WebSource {
  title: string;
  url: string;
  domain?: string;
}

export interface LlmProvider {
  streamChatCompletion(
    systemPrompt: string,
    history: ChatTurn[],
    onDelta: (text: string) => void,
    // Only Gemini implements this today (native Google Search grounding).
    // Other providers simply never call it — real sources or none, never fabricated.
    onWebSources?: (sources: WebSource[]) => void
  ): Promise<void>;
}
