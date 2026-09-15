import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy, ImageIcon, Globe } from "lucide-react";
import type { ChatTurn, GeneratedImage, Source } from "../lib/api";
import { Orb } from "./orb/Orb";

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

  // JENNYSOL-UI-BUILD.md §6.1: user bubbles raised-2, right-aligned; assistant
  // bubbles raised, left-aligned, with a small asleep-orb marker and a
  // provenance line beneath — "Arena · 2 sources" in the mockup's exact
  // phrasing, generalized here to whatever the real sources array names
  // (a real web result's domain, or a document source's own label), not a
  // fixed string. No provenance line when there's genuinely nothing to cite.
  if (isUser) {
    return (
      <div className="flex animate-slide-up justify-end">
        <div className="max-w-[75%] min-w-0 break-words rounded-2xl rounded-br-md bg-jenny-raised-2 px-3.5 py-2.5 text-sm leading-relaxed text-jenny-text">
          <p className="whitespace-pre-wrap">{content}</p>
        </div>
      </div>
    );
  }

  const provenance =
    sources && sources.length > 0
      ? sources.every((s) => s.type === "web")
        ? `${sources.length} web ${sources.length === 1 ? "source" : "sources"}`
        : `${sources.length} ${sources.length === 1 ? "source" : "sources"}`
      : null;

  return (
    <div className="flex animate-slide-up gap-2.5">
      <Orb state="asleep" size="sm" className="mt-0.5" />

      <div className="group flex min-w-0 max-w-[85%] flex-1 flex-col gap-1.5">
        <div className="min-w-0 break-words rounded-2xl rounded-bl-md bg-jenny-raised px-3.5 py-3 text-sm leading-relaxed text-jenny-text-2">
          {imageLoading ? (
            <span className="flex items-center gap-2 py-1 text-jenny-muted">
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
            <div className="prose prose-sm prose-invert max-w-none prose-p:my-1.5 prose-pre:my-2 prose-pre:bg-jenny-void prose-pre:text-jenny-text-2 prose-code:before:content-none prose-code:after:content-none">
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
              {statusLabel && <span className="text-xs text-jenny-dim">{statusLabel}</span>}
            </span>
          ) : (
            // Not streaming and no content — a genuinely finished reply with
            // nothing in it (should be rare — see chatRunner.ts's own
            // non-empty guarantee — but covers any pre-existing message and
            // any future edge case) rather than looking identical to "still
            // thinking forever".
            <span className="italic text-jenny-dim">No response.</span>
          )}
        </div>

        {provenance && <p className="px-1 text-[11px] text-jenny-dim">Arena · {provenance}</p>}

        {sources && sources.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-1">
            {sources.map((s, i) =>
              s.type === "web" ? (
                <a
                  key={i}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={s.url}
                  className="flex max-w-[220px] items-center gap-1 truncate rounded-full border border-jenny-gold-deep bg-jenny-gold/10 px-2.5 py-0.5 text-[10px] text-jenny-champagne transition hover:bg-jenny-gold/20"
                >
                  <Globe size={10} className="shrink-0" />
                  <span className="truncate">{s.domain || s.title}</span>
                </a>
              ) : (
                <span
                  key={i}
                  title={s.text}
                  className="max-w-[220px] truncate rounded-full border border-jenny-hairline-card bg-jenny-raised px-2.5 py-0.5 text-[10px] text-jenny-muted"
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
            className="ml-1 flex items-center gap-1 text-[10px] text-jenny-dim opacity-0 transition hover:text-jenny-text-3 group-hover:opacity-100"
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
    </div>
  );
}
