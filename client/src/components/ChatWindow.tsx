import { useRef, useState } from "react";
import { sendChatMessage, type ChatTurn } from "../lib/api";
import { MessageBubble } from "./MessageBubble";

export function ChatWindow() {
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;

    const history = messages;
    const nextMessages: ChatTurn[] = [...history, { role: "user", content: text }, { role: "assistant", content: "" }];
    setMessages(nextMessages);
    setInput("");
    setSending(true);

    try {
      await sendChatMessage(
        text,
        history,
        (delta) => {
          setMessages((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = {
              role: "assistant",
              content: copy[copy.length - 1].content + delta,
            };
            return copy;
          });
          bottomRef.current?.scrollIntoView({ behavior: "smooth" });
        },
        () => setSending(false)
      );
    } catch {
      setSending(false);
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: "assistant", content: "Something went wrong. Please try again." };
        return copy;
      });
    }
  }

  return (
    <div className="flex flex-col flex-1 h-full">
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-neutral-400 text-sm mt-20">
            Upload documents on the left, then ask a question grounded in them.
          </div>
        )}
        {messages.map((m, i) => (
          <MessageBubble key={i} role={m.role} content={m.content} />
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-neutral-200 p-4 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="Ask Jennysol…"
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          onClick={handleSend}
          disabled={sending}
          className="rounded-lg bg-indigo-600 text-white px-4 py-2 text-sm disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
