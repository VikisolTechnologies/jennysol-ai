import { Link } from "react-router-dom";
import { ArrowLeft, Code2, Compass, Globe2, MapPin, MessageSquareCode, Search as SearchIcon } from "lucide-react";

// Honest by construction: JennySol's chat already runs on a durable
// execution model (AgentRun — see server/src/services/agentRunStore.ts)
// under every reply, but there is no user-facing catalog of purpose-built
// agents to run on top of it yet. This page says exactly that instead of
// pretending a "Run agent" button does something. Nothing here invokes any
// backend route — there's genuinely nothing real to invoke yet.
const PLANNED_AGENTS = [
  { id: "research", label: "Research", icon: SearchIcon, description: "Multi-step web research with cited sources." },
  { id: "travel", label: "Travel planning", icon: MapPin, description: "Compare options and build an itinerary." },
  { id: "coding", label: "Coding", icon: Code2, description: "Multi-file changes with test verification." },
  { id: "assistant", label: "Personal assistant", icon: MessageSquareCode, description: "Ongoing tasks across conversations." },
];

export function Agents() {
  return (
    <div className="h-[var(--app-vh)] overflow-y-auto bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-brand-500 dark:text-neutral-400"
        >
          <ArrowLeft size={14} /> Back to chat
        </Link>

        <div className="mt-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-gradient text-white shadow-lg shadow-brand-500/30">
            <Compass size={20} />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Agents</h1>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">Purpose-built AI agents, built on JennySol's core.</p>
          </div>
        </div>

        <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-3 text-sm text-neutral-600 dark:border-white/15 dark:bg-white/5 dark:text-neutral-300">
          <Globe2 size={16} className="mt-0.5 shrink-0" />
          <span>
            There's no library of dedicated agents to run yet — this page shows what's planned, not
            what's already working. Every conversation with Jenny already runs on the same durable
            execution model these agents would eventually use, so nothing here is a redesign, just
            not built on top of it yet.
          </span>
        </div>

        <h2 className="mt-8 text-xs font-semibold uppercase tracking-wide text-neutral-400">Planned</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {PLANNED_AGENTS.map((agent) => (
            <div
              key={agent.id}
              className="flex flex-col gap-2 rounded-2xl border border-neutral-200 bg-white p-4 opacity-70 dark:border-white/10 dark:bg-neutral-900"
            >
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500 dark:bg-white/5 dark:text-neutral-400">
                  <agent.icon size={15} />
                </div>
                <p className="text-sm font-semibold">{agent.label}</p>
              </div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">{agent.description}</p>
              <span className="mt-1 inline-flex w-fit items-center rounded-full bg-neutral-100 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-neutral-500 dark:bg-white/5 dark:text-neutral-400">
                Coming soon
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
