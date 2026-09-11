import { Link } from "react-router-dom";
import { ArrowLeft, Calendar, Mail, Plug, Users, Video } from "lucide-react";

// No integration provider (Calendar/Email/Teams/Zoom) has any real
// implementation anywhere in this codebase — no OAuth app registration, no
// provider interface, no credentials. Every row below is honestly
// "Not available" with no clickable "Connect" action, rather than a button
// that starts a flow which doesn't exist.
const INTEGRATIONS = [
  { id: "calendar", label: "Calendar", icon: Calendar, description: "See your schedule and let Jenny help plan around it." },
  { id: "email", label: "Email", icon: Mail, description: "Draft and summarize email with your inbox as context." },
  { id: "teams", label: "Microsoft Teams", icon: Users, description: "Bring Jenny into Teams conversations and meetings." },
  { id: "zoom", label: "Zoom", icon: Video, description: "Meeting summaries and scheduling through Zoom." },
];

export function Integrations() {
  return (
    <div className="h-[var(--app-vh)] overflow-y-auto bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-brand-500 dark:text-neutral-400">
          <ArrowLeft size={14} /> Back to chat
        </Link>

        <div className="mt-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-neutral-100 text-neutral-400 dark:bg-white/5">
            <Plug size={20} />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Integrations</h1>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">Connect other services to JennySol.</p>
          </div>
        </div>

        <p className="mt-6 text-sm text-neutral-500 dark:text-neutral-400">
          None of these exist as real, working connections yet — shown honestly as unavailable
          rather than hidden, so you know what's planned.
        </p>

        <ul className="mt-4 flex flex-col gap-2">
          {INTEGRATIONS.map((i) => (
            <li
              key={i.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-4 dark:border-white/10 dark:bg-neutral-900"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-100 text-neutral-400 dark:bg-white/5">
                  <i.icon size={16} />
                </div>
                <div>
                  <p className="text-sm font-medium">{i.label}</p>
                  <p className="text-xs text-neutral-400">{i.description}</p>
                </div>
              </div>
              <span className="shrink-0 rounded-full bg-neutral-100 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-neutral-500 dark:bg-white/10 dark:text-neutral-400">
                Not available
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
