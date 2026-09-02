import { useEffect, useRef, useState } from "react";
import { Menu, Moon, SendHorizontal, Sparkles, Sun } from "lucide-react";
import { sendChatMessage, type ChatTurn, type Source } from "../lib/api";
import { MessageBubble } from "./MessageBubble";
import { useTheme } from "../lib/useTheme";

interface DisplayMessage extends ChatTurn {
  sources?: Source[];
}

const SUGGESTIONS = [
  "Summarize the documents I've uploaded",
  "What are the key points I should know?",
  "Explain this in simple terms",
];

export function ChatWindow({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function autoResize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  async function handleSend(text = input.trim()) {
    if (!text || sending) return;

    const history = messages.map(({ role, content }) => ({ role, content }));
    setMessages((prev) => [...prev, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setInput("");
    requestAnimationFrame(autoResize);
    setSending(true);

    try {
      await sendChatMessage(
        text,
        history,
        (delta) => {
          setMessages((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = {
              ...copy[copy.length - 1],
              content: copy[copy.length - 1].content + delta,
            };
            return copy;
          });
        },
        (sources) => {
          setSending(false);
          setMessages((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = { ...copy[copy.length - 1], sources };
            return copy;
          });
        }
      );
    } catch (err) {
      setSending(false);
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = {
          role: "assistant",
          content: err instanceof Error ? err.message : "Something went wrong reaching the server.",
        };
        return copy;
      });
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-neutral-100/50 dark:bg-neutral-950">
      <header className="flex shrink-0 items-center justify-between border-b border-neutral-200 bg-white/80 px-4 py-3 backdrop-blur-xl dark:border-white/10 dark:bg-neutral-950/80">
        <div className="flex items-center gap-2">
          <button
            onClick={onOpenSidebar}
            className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-white/10 md:hidden"
            aria-label="Open sidebar"
          >
            <Menu size={18} />
          </button>
          <span className="text-sm font-semibold">Chat</span>
        </div>
        <button
          onClick={toggleTheme}
          className="rounded-lg p-2 text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-white/10 dark:hover:text-neutral-200"
          aria-label="Toggle theme"
        >
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-6 sm:px-8">
        {messages.length === 0 && (
          <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-lg shadow-brand-500/30">
              <Sparkles size={26} />
            </div>
            <div>
              <h2 className="text-lg font-bold">Ask Jennysol anything</h2>
              <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                Upload documents in the sidebar so answers are grounded in them, or just start chatting.
              </p>
            </div>
            <div className="flex flex-col gap-2 self-stretch">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSend(s)}
                  className="rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-left text-sm text-neutral-600 shadow-sm transition hover:border-brand-300 hover:text-neutral-900 dark:border-white/10 dark:bg-white/[0.03] dark:text-neutral-300 dark:hover:border-brand-400/50 dark:hover:text-white"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mx-auto max-w-3xl space-y-4">
          {messages.map((m, i) => (
            <MessageBubble
              key={i}
              role={m.role}
              content={m.content}
              sources={m.sources}
              streaming={sending && i === messages.length - 1}
            />
          ))}
        </div>
        <div ref={bottomRef} />
      </div>

      <div className="shrink-0 border-t border-neutral-200 bg-white/80 p-3 backdrop-blur-xl dark:border-white/10 dark:bg-neutral-950/80 sm:p-4">
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-neutral-200 bg-white p-1.5 shadow-sm focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-500/20 dark:border-white/10 dark:bg-white/[0.04]">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              autoResize();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            rows={1}
            placeholder="Ask Jennysol…"
            className="max-h-40 flex-1 resize-none bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-neutral-400"
          />
          <button
            onClick={() => handleSend()}
            disabled={sending || !input.trim()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-gradient text-white transition disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Send message"
          >
            <SendHorizontal size={16} />
          </button>
        </div>
        <p className="mt-2 text-center text-[10px] text-neutral-400">
          Jennysol can make mistakes. Verify important information.
        </p>
      </div>
    </div>
  );
}
