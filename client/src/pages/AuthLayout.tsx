import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    // h-[var(--app-vh)] + overflow-y-auto (not min-h-) because the document
    // itself no longer scrolls at all (see index.css) — this is now the one
    // scroll region that has to handle a form taller than the viewport
    // (e.g. signup's extra fields with the keyboard open on a short screen).
    <div className="flex h-[var(--app-vh)] items-center justify-center overflow-y-auto bg-neutral-50 px-4 py-10 dark:bg-neutral-950">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-lg shadow-brand-500/30">
            <Sparkles size={24} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{subtitle}</p>}
          </div>
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
          {children}
        </div>

        {footer && <div className="mt-4 text-center text-sm text-neutral-500 dark:text-neutral-400">{footer}</div>}
      </div>
    </div>
  );
}

export function AuthError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">
      {message}
    </p>
  );
}

export function AuthField({
  label,
  type = "text",
  value,
  onChange,
  autoComplete,
  required = true,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        required={required}
        className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-base outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20 dark:border-white/10 dark:bg-white/5 dark:text-neutral-100"
      />
    </label>
  );
}

export function AuthSubmit({ loading, children }: { loading: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="mt-1 w-full rounded-lg bg-brand-gradient px-3 py-2.5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
    >
      {loading ? "…" : children}
    </button>
  );
}
