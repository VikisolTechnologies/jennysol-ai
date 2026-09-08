import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

// A render-time crash anywhere below this used to mean a blank white screen
// for that user, permanently, until they figured out to reload — React
// doesn't recover from a component throwing on its own. This catches it,
// reports it (best-effort, never blocks the fallback UI on the report
// succeeding), and gives the user an actual way out.
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    fetch(`${API_BASE}/api/errors/client`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: error.message,
        stack: `${error.stack ?? ""}\n${info.componentStack ?? ""}`.slice(0, 8000),
        path: window.location.pathname,
      }),
    }).catch(() => {
      // Reporting failed too — nothing more useful to do than let the
      // fallback UI below stand on its own.
    });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-[var(--app-vh)] w-screen flex-col items-center justify-center gap-4 bg-white px-6 text-center dark:bg-neutral-950">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-rose-500 dark:bg-rose-500/10">
          <AlertTriangle size={22} />
        </div>
        <div>
          <h1 className="text-base font-semibold text-neutral-800 dark:text-neutral-100">Something went wrong</h1>
          <p className="mt-1 max-w-sm text-sm text-neutral-500 dark:text-neutral-400">
            JennySol hit an unexpected error. It's been reported — reloading usually fixes it.
          </p>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="rounded-xl bg-brand-gradient px-4 py-2 text-sm font-semibold text-white shadow-md shadow-brand-500/25 transition hover:opacity-90"
        >
          Reload
        </button>
      </div>
    );
  }
}
