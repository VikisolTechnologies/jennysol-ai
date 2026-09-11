import { AlertTriangle, ExternalLink } from "lucide-react";

export function AccountPrivacy() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-white">Privacy</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          What JennySol stores about your account, in plain language.
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-5 text-sm text-neutral-600 dark:border-white/10 dark:bg-neutral-900 dark:text-neutral-300">
        <p>
          Your conversations and any files you upload are scoped to your account — no other user
          can see them. JennySol keeps your conversation history so you can return to past chats;
          it does not currently maintain a separate long-term memory that extracts and recalls
          facts about you across conversations.
        </p>
        <p>
          When a question needs live information, JennySol sends the search query (not your full
          conversation) to a third-party search provider. No provider API key is ever exposed to
          your browser.
        </p>
        <a
          href="/privacy"
          target="_blank"
          rel="noreferrer"
          className="flex w-fit items-center gap-1.5 text-brand-600 underline hover:no-underline dark:text-brand-400"
        >
          Read the full Privacy Policy
          <ExternalLink size={13} />
        </a>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200">
        <div className="flex items-start gap-2.5">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">Account deletion isn't self-service yet</p>
            <p className="mt-1 text-amber-700 dark:text-amber-300/90">
              There's no backend support yet for deleting your account and its data automatically
              from this page — we're not going to show a delete button that doesn't actually do
              anything. If you want your account and data removed now, contact Vikisol
              Technologies directly and it'll be handled manually.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
