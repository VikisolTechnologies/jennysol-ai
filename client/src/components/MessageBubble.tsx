import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy, ImageIcon, Sparkles, Globe } from "lucide-react";
import type { ChatTurn, GeneratedImage, Source } from "../lib/api";

export function MessageBubble({
  role,
  content,
  sources,
  streaming,
  image,
  imageLoading,
  statusLabel,
}: ChatTurn & {
  sources?: Source[];
  streaming?: boolean;
  image?: GeneratedImage;
  imageLoading?: boolean;
  // Shown next to the "thinking" dots while content is still empty — lets a
  // slow/reconnecting request read as active status ("Still working…",
  // "Reconnecting…") instead of an indefinite spinner with no explanation.
  // Never shown once real content has started streaming.
  statusLabel?: string;
}) {
  const isUser = role === "user";
  const [copied, setCopied] = useState(false);

  // Matches ChatGPT's transcript conventions: user turns are a plain bubble,
  // right-aligned, no avatar; assistant turns have no bubble at all — just an
  // avatar and flush text, so long answers read as a document, not a box.
  if (isUser) {
    return (
      <div className="flex animate-slide-up justify-end">
        <div className="max-w-[75%] min-w-0 break-words rounded-3xl bg-neutral-100 px-4 py-2.5 text-sm leading-relaxed text-neutral-800 dark:bg-white/10 dark:text-neutral-100">
          <p className="whitespace-pre-wrap">{content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex animate-slide-up gap-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-white shadow-md shadow-brand-500/25">
        <Sparkles size={14} />
      </div>

      <div className="group flex min-w-0 max-w-[85%] flex-1 flex-col gap-1.5">
        <div className="min-w-0 break-words text-sm leading-relaxed text-neutral-800 dark:text-neutral-100">
          {imageLoading ? (
            <span className="flex items-center gap-2 py-1 text-neutral-500 dark:text-neutral-400">
              <ImageIcon size={14} className="animate-pulse" />
              Generating image…
            </span>
          ) : image ? (
            <img
              src={`data:${image.mimeType};base64,${image.data}`}
              alt={content || "Generated image"}
              className="max-w-full rounded-lg"
            />
          ) : content ? (
            <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none prose-p:my-1.5 prose-pre:my-2 prose-pre:bg-neutral-900 prose-pre:text-neutral-100 prose-code:before:content-none prose-code:after:content-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
              {streaming && (
                <span className="ml-0.5 inline-block h-[1em] w-[0.5em] translate-y-[0.15em] animate-pulse bg-current align-middle" />
              )}
            </div>
          ) : streaming ? (
            <span className="flex items-center gap-2 py-1">
              <span className="flex gap-1">
                <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-current [animation-delay:-0.3s]" />
                <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-current [animation-delay:-0.15s]" />
                <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-current" />
              </span>
              {statusLabel && (
                <span className="text-xs text-neutral-400 dark:text-neutral-500">{statusLabel}</span>
              )}
            </span>
          ) : (
            // Not streaming and no content — a genuinely finished reply
            // with nothing in it (should be rare now that chatRunner.ts
            // guarantees non-empty text server-side, but this covers any
            // message saved before that fix, and any future edge case).
            // Previously this fell into the same branch as the dots above,
            // which meant a finished empty message looked identical to one
            // still "thinking" — indistinguishable from being stuck forever.
            <span className="italic text-neutral-400 dark:text-neutral-500">No response.</span>
          )}
        </div>

        {sources && sources.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {sources.map((s, i) =>
              s.type === "web" ? (
                <a
                  key={i}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={s.url}
                  className="flex max-w-[220px] items-center gap-1 truncate rounded-full border border-brand-200 bg-brand-50 px-2.5 py-0.5 text-[10px] text-brand-700 transition hover:bg-brand-100 dark:border-brand-500/25 dark:bg-brand-500/10 dark:text-brand-300 dark:hover:bg-brand-500/20"
                >
                  <Globe size={10} className="shrink-0" />
                  <span className="truncate">{s.domain || s.title}</span>
                </a>
              ) : (
                <span
                  key={i}
                  title={s.text}
                  className="max-w-[220px] truncate rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-0.5 text-[10px] text-neutral-500 dark:border-white/10 dark:bg-white/5 dark:text-neutral-400"
                >
                  [{i + 1}] {s.text.slice(0, 40)}…
                </span>
              )
            )}
          </div>
        )}

        {content && !streaming && (
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
