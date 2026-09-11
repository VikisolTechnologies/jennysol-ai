import { Link } from "react-router-dom";
import { ArrowLeft, Code2, Compass, Globe2, MapPin, MessageSquareCode, Search as SearchIcon } from "lucide-react";

// Honest by construction. Two things confirmed by direct inspection before
// writing this page:
//   1. JennySol's chat already runs on a durable execution model (AgentRun
//      — agentRunStore.ts) for every reply.
//   2. The only tool-calling/registry infrastructure that exists in this
//      repo (ToolRegistry, ProductConnector) is architecturally scoped to
//      cross-product identities (Arena-style callers) — productIdentity.ts
//      explicitly states a real JennySol session token must never be
//      accepted there. Bridging JennySol's own users into that system would
//      be new cross-boundary architecture, which is exactly what this
//      task's Arena boundary says not to build.
// So there is genuinely no agent a JennySol user can run today. Every card
// below is inert: no Run button, no backend call, no fake execution.
interface PlannedAgent {
  id: string;
  label: string;
  icon: typeof SearchIcon;
  description: string;
  tools: string;
  data: string;
  input: string;
  output: string;
}

const PLANNED_AGENTS: PlannedAgent[] = [
  {
    id: "research",
    label: "Research",
    icon: SearchIcon,
    description: "Multi-step web research with cited sources.",
    tools: "Web search (Tavily)",
    data: "None beyond the conversation itself",
    input: "A research question or topic",
    output: "A written summary with citations",
  },
  {
    id: "travel",
    label: "Travel planning",
    icon: MapPin,
    description: "Compare options and build an itinerary.",
    tools: "Web search, weather",
    data: "None beyond the conversation itself",
    input: "Destination, dates, preferences",
    output: "A comparison and a draft itinerary",
  },
  {
    id: "coding",
    label: "Coding",
    icon: Code2,
    description: "Multi-file changes with test verification.",
    tools: "Not yet defined",
    data: "A connected code repository (not built)",
    input: "A coding task description",
    output: "Code changes with test results",
  },
  {
    id: "assistant",
    label: "Personal assistant",
    icon: MessageSquareCode,
    description: "Ongoing tasks across conversations.",
    tools: "Not yet defined",
    data: "Task/memory persistence (not built — see Tasks and Memory)",
    input: "An ongoing goal or recurring task",
    output: "Status updates over time",
  },
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
            There's no library of dedicated agents to run yet — this page shows what's planned,
            not what's already working. Every conversation with Jenny already runs on the same
            durable execution model these agents would eventually use, so nothing here is a
            redesign, just not built on top of it yet. Each card below shows what that agent would
            need and produce once it exists.
          </span>
        </div>

        <h2 className="mt-8 text-xs font-semibold uppercase tracking-wide text-neutral-400">Planned</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {PLANNED_AGENTS.map((agent) => (
            <div
              key={agent.id}
              className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-white/10 dark:bg-neutral-900"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500 dark:bg-white/5 dark:text-neutral-400">
                    <agent.icon size={15} />
                  </div>
                  <p className="text-sm font-semibold">{agent.label}</p>
                </div>
                <span className="shrink-0 rounded-full bg-neutral-100 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-neutral-500 dark:bg-white/5 dark:text-neutral-400">
                  Coming soon
                </span>
              </div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">{agent.description}</p>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-neutral-100 pt-3 text-[11px] dark:border-white/10">
                <dt className="text-neutral-400">Tools</dt>
                <dd className="text-neutral-600 dark:text-neutral-300">{agent.tools}</dd>
                <dt className="text-neutral-400">Data access</dt>
                <dd className="text-neutral-600 dark:text-neutral-300">{agent.data}</dd>
                <dt className="text-neutral-400">Input</dt>
                <dd className="text-neutral-600 dark:text-neutral-300">{agent.input}</dd>
                <dt className="text-neutral-400">Output</dt>
                <dd className="text-neutral-600 dark:text-neutral-300">{agent.output}</dd>
              </dl>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
