import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { authFetch } from "../lib/auth";

interface Step {
  id: string;
  index: number;
  kind: string;
  toolName?: string;
  error?: string;
  endedAt?: number | null;
}

interface GoalRun {
  id: string;
  goal: string;
  status: string;
  content: string;
  stopReason?: string;
}

export function GoalRuns() {
  const [runs, setRuns] = useState<Array<{ run: GoalRun; steps: Step[] }>>([]);
  const [goal, setGoal] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await authFetch("/api/goal-runs");
    if (!res.ok) {
      setError("Couldn't load runs.");
      return;
    }
    const body = (await res.json()) as { runs: Array<{ run: GoalRun; steps: Step[] }> };
    setRuns(body.runs);
  }

  useEffect(() => {
    void load();
  }, []);

  async function start(event: FormEvent) {
    event.preventDefault();
    if (!goal.trim()) return;
    setBusy(true);
    setError("");
    const res = await authFetch("/api/goal-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal }),
    });
    setBusy(false);
    if (!res.ok) {
      setError("The run didn't start.");
      return;
    }
    setGoal("");
    await load();
  }

  async function stop(id: string) {
    const res = await authFetch(`/api/goal-runs/${id}/stop`, { method: "POST" });
    if (!res.ok) {
      setError("Couldn't stop that run.");
      return;
    }
    await load();
  }

  return (
    <div className="h-[var(--app-vh)] overflow-y-auto bg-[#09090b] text-[#f2f2f3]">
      <div className="mx-auto max-w-xl px-4 py-8">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-[#8b8b93]">
          <ArrowLeft size={14} /> Back to chat
        </Link>
        <h1 className="mt-6 text-xl font-semibold">Runs</h1>
        <p className="mt-1 text-sm text-[#8b8b93]">Each run is a timeline. Steps stack in order. You can stop a run that's still going.</p>

        <form onSubmit={start} className="mt-6 flex gap-2">
          <input
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder="What should Jenny work on?"
            className="min-w-0 flex-1 rounded-full border border-[#232326] bg-[#141416] px-4 py-2 text-sm"
          />
          <button type="submit" disabled={busy || !goal.trim()} className="rounded-full bg-[#ff6b35] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
            Start
          </button>
        </form>
        {error && <p className="mt-3 text-sm text-[#e5534b]">{error}</p>}

        {runs.length === 0 && !error && (
          <p className="mt-8 rounded-2xl border border-dashed border-[#232326] px-4 py-5 text-sm text-[#8b8b93]">
            No runs yet. A run appears here after you start one.
          </p>
        )}

        <div className="mt-6 flex flex-col gap-3">
          {runs.map(({ run, steps }) => (
            <article key={run.id} className="rounded-2xl border border-[#232326] bg-[#141416] p-4">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-sm font-semibold">{run.goal}</h2>
                <span className="shrink-0 rounded-full bg-[#ff6b35]/15 px-2.5 py-1 text-[11px] font-semibold text-[#ff8a5b]">{run.status}</span>
              </div>
              <ol className="mt-3 flex flex-col gap-2 border-l border-[#232326] pl-3">
                {steps.map((step) => (
                  <li key={step.id} className="text-sm">
                    <span className="text-[11px] text-[#8b8b93]">Step {step.index + 1} · {step.kind}</span>
                    <div>{step.toolName ?? run.content ?? "Answer"}</div>
                    {step.error && <div className="text-[#e5534b]">{step.error}</div>}
                  </li>
                ))}
              </ol>
              {run.content && <p className="mt-3 text-sm">{run.content}</p>}
              {(run.status === "running" || run.status === "queued") && (
                <button type="button" onClick={() => void stop(run.id)} className="mt-3 rounded-full border border-[#e5534b] px-3 py-1 text-xs font-semibold text-[#e5534b]">
                  Stop
                </button>
              )}
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
