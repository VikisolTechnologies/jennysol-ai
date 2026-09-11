import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemePreference } from "../../lib/useTheme";

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export function AccountAppearance() {
  const { preference, setPreference } = useTheme();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-white">Appearance</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Choose how JennySol looks on this device. "System" follows your OS setting automatically.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {OPTIONS.map((opt) => {
          const active = preference === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => setPreference(opt.value)}
              className={`flex flex-col items-center gap-2 rounded-xl border p-4 transition ${
                active
                  ? "border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-500/10"
                  : "border-neutral-200 bg-white hover:border-neutral-300 dark:border-white/10 dark:bg-neutral-900 dark:hover:border-white/20"
              }`}
              aria-pressed={active}
            >
              <opt.icon size={20} className={active ? "text-brand-600 dark:text-brand-300" : "text-neutral-400"} />
              <span className={`text-sm font-medium ${active ? "text-brand-700 dark:text-brand-200" : "text-neutral-600 dark:text-neutral-300"}`}>
                {opt.label}
              </span>
              {active && <Check size={13} className="text-brand-600 dark:text-brand-300" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
