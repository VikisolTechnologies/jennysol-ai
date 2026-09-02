import type { ChatTurn } from "../lib/api";

export function MessageBubble({ role, content }: ChatTurn) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-2 whitespace-pre-wrap text-sm leading-relaxed ${
          isUser ? "bg-indigo-600 text-white" : "bg-neutral-100 text-neutral-900"
        }`}
      >
        {content || (isUser ? "" : "…")}
      </div>
    </div>
  );
}
