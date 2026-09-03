import { NavLink, Outlet } from "react-router-dom";
import { AlertTriangle, ArrowLeft, LayoutDashboard, Users } from "lucide-react";

const NAV_ITEMS = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/admin/users", label: "Users", icon: Users, end: false },
  { to: "/admin/errors", label: "Errors", icon: AlertTriangle, end: false },
];

export function AdminLayout() {
  return (
    <div className="flex min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <aside className="flex w-56 shrink-0 flex-col gap-1 border-r border-neutral-200 p-4 dark:border-white/10">
        <NavLink
          to="/"
          className="mb-4 flex items-center gap-1.5 text-xs font-medium text-neutral-500 hover:text-brand-500 dark:text-neutral-400"
        >
          <ArrowLeft size={13} /> Back to app
        </NavLink>
        <h2 className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Admin</h2>
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
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
      </aside>
      <main className="min-w-0 flex-1 overflow-x-auto p-6 sm:p-8">
        <Outlet />
      </main>
    </div>
  );
}
