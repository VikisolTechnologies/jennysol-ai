import { NavLink, Outlet } from "react-router-dom";
import { ArrowLeft, Lock, Palette, Shield, ShieldCheck, User } from "lucide-react";

const NAV_ITEMS = [
  { to: "/account", label: "Profile", icon: User, end: true },
  { to: "/account/security", label: "Security", icon: Shield, end: false },
  { to: "/account/sessions", label: "Sessions", icon: ShieldCheck, end: false },
  { to: "/account/appearance", label: "Appearance", icon: Palette, end: false },
  { to: "/account/privacy", label: "Privacy", icon: Lock, end: false },
];

// A fixed-width left sidebar (the same pattern AdminLayout.tsx uses) eats
// more than half of a 390px viewport and squeezes every page's content into
// an unreadable ~165px column — confirmed via a real mobile-viewport
// screenshot, not assumed. Below `sm`, the nav collapses into a horizontal
// scrollable tab bar instead; the sidebar returns at `sm` and up.
export function AccountLayout() {
  return (
    <div className="flex h-[var(--app-vh)] flex-col bg-neutral-50 dark:bg-neutral-950 sm:flex-row">
      <aside className="flex shrink-0 flex-col gap-1 border-b border-neutral-200 p-3 dark:border-white/10 sm:w-56 sm:overflow-y-auto sm:border-b-0 sm:border-r sm:p-4">
        <NavLink
          to="/"
          className="mb-2 flex items-center gap-1.5 px-1 text-xs font-medium text-neutral-500 hover:text-brand-500 dark:text-neutral-400 sm:mb-4"
        >
          <ArrowLeft size={13} /> Back to chat
        </NavLink>
        <h2 className="mb-1 hidden px-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400 sm:mb-2 sm:block">
          Account
        </h2>
        <div className="-mx-3 flex gap-1 overflow-x-auto px-3 sm:mx-0 sm:flex-col sm:overflow-visible sm:px-0">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition ${
                  isActive
                    ? "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200"
                    : "text-neutral-600 hover:bg-neutral-200/60 dark:text-neutral-300 dark:hover:bg-white/5"
                }`
              }
            >
              <item.icon size={15} />
              {item.label}
            </NavLink>
          ))}
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-auto p-4 sm:p-8">
        <div className="mx-auto max-w-xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
