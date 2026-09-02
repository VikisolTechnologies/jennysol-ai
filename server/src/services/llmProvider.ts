export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface LlmProvider {
  streamChatCompletion(
    systemPrompt: string,
    history: ChatTurn[],
    onDelta: (text: string) => void
  ): Promise<void>;
}
