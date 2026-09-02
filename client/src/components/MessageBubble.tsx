import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy, Sparkles, User } from "lucide-react";
import type { ChatTurn, Source } from "../lib/api";

export function MessageBubble({
  role,
  content,
  sources,
  streaming,
}: ChatTurn & { sources?: Source[]; streaming?: boolean }) {
  const isUser = role === "user";
  const [copied, setCopied] = useState(false);

  return (
    <div className={`flex animate-slide-up gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          isUser
            ? "bg-neutral-200 text-neutral-600 dark:bg-white/10 dark:text-neutral-300"
            : "bg-brand-gradient text-white shadow-md shadow-brand-500/25"
        }`}
      >
        {isUser ? <User size={14} /> : <Sparkles size={14} />}
      </div>

      <div className={`group flex max-w-[80%] flex-col gap-1.5 ${isUser ? "items-end" : "items-start"}`}>
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
            isUser
              ? "rounded-tr-sm bg-brand-gradient text-white"
              : "rounded-tl-sm border border-neutral-200 bg-white text-neutral-800 dark:border-white/10 dark:bg-white/[0.04] dark:text-neutral-100"
          }`}
        >
          {content ? (
            isUser ? (
              <p className="whitespace-pre-wrap">{content}</p>
            ) : (
              <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none prose-p:my-1.5 prose-pre:my-2 prose-pre:bg-neutral-900 prose-pre:text-neutral-100 prose-code:before:content-none prose-code:after:content-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
              </div>
            )
          ) : (
            <span className="flex gap-1 py-1">
              <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-current [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-current [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-current" />
            </span>
          )}
        </div>

        {sources && sources.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {sources.map((s, i) => (
              <span
                key={i}
                title={s.text}
                className="max-w-[220px] truncate rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-0.5 text-[10px] text-neutral-500 dark:border-white/10 dark:bg-white/5 dark:text-neutral-400"
              >
                [{i + 1}] {s.text.slice(0, 40)}…
              </span>
            ))}
          </div>
        )}

        {!isUser && content && !streaming && (
          <button
            onClick={() => {
              navigator.clipboard.writeText(content);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="flex items-center gap-1 text-[10px] text-neutral-400 opacity-0 transition hover:text-neutral-600 group-hover:opacity-100 dark:hover:text-neutral-200"
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
    </div>
  );
}
