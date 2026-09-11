import { Link } from "react-router-dom";
import { ArrowLeft, ListTodo } from "lucide-react";

// No task/automation backend exists anywhere in this codebase (confirmed by
// inspection — no scheduling, no background jobs, no task persistence).
// This is the correct, honest product boundary for that: says plainly that
// it's not built, invokes nothing, offers no fake "create task" form.
export function Tasks() {
  return (
    <div className="h-[var(--app-vh)] overflow-y-auto bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-brand-500 dark:text-neutral-400">
          <ArrowLeft size={14} /> Back to chat
        </Link>

        <div className="mt-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-neutral-100 text-neutral-400 dark:bg-white/5">
            <ListTodo size={20} />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Tasks</h1>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">Ongoing and scheduled work JennySol can track for you.</p>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-5 text-sm text-neutral-600 dark:border-white/15 dark:bg-white/5 dark:text-neutral-300">
          <p>
            Tasks aren't built yet — there's no scheduling, background execution, or persistent
            task tracking in JennySol today. Every conversation only responds to what you ask it
            in that moment.
          </p>
          <span className="mt-3 inline-flex w-fit items-center rounded-full bg-neutral-100 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-neutral-500 dark:bg-white/10 dark:text-neutral-400">
            Coming soon
          </span>
        </div>
      </div>
    </div>
  );
}
