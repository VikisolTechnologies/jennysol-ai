import { useEffect, useState } from "react";
import { AlertTriangle, MessageSquare, TrendingUp, Users } from "lucide-react";
import { fetchAdminStats, type AdminStats } from "../../lib/admin";

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Users;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-white/10 dark:bg-white/5">
      <div className="flex items-center gap-2 text-neutral-400">
        <Icon size={15} />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold text-neutral-800 dark:text-neutral-100">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-neutral-400">{sub}</p>}
    </div>
  );
}

// A minimal day-by-day bar list — deliberately not a charting library
// dependency for what's currently ~14 data points.
function TrendBars({ data, label }: { data: { day: string; count: number }[]; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-white/10 dark:bg-white/5">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">{label}</h3>
      {data.length === 0 ? (
        <p className="text-xs text-neutral-400">No data yet.</p>
      ) : (
        <div className="flex items-end gap-1.5" style={{ height: 80 }}>
          {data.map((d) => (
            <div key={d.day} className="flex flex-1 flex-col items-center gap-1" title={`${d.day}: ${d.count}`}>
              <div
                className="w-full rounded-t bg-brand-gradient"
                style={{ height: `${Math.max(4, (d.count / max) * 64)}px` }}
              />
              <span className="text-[9px] text-neutral-400">{d.day.slice(5)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AdminDashboard() {
  const [data, setData] = useState<{ stats: AdminStats; errorsLast24h: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAdminStats()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load stats"));
  }, []);

  if (error) return <p className="text-sm text-rose-500">{error}</p>;
  if (!data) return <p className="text-sm text-neutral-400">Loading…</p>;

  const { stats, errorsLast24h } = data;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-bold text-neutral-800 dark:text-neutral-100">Dashboard</h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={Users} label="Total users" value={stats.totalUsers} sub={`+${stats.newSignups7d} in 7d`} />
        <StatCard icon={TrendingUp} label="Active (7d)" value={stats.activeUsers7d} sub={`${stats.activeUsers24h} in 24h`} />
        <StatCard icon={MessageSquare} label="Conversations" value={stats.totalConversations} sub={`${stats.totalMessages} messages`} />
        <StatCard icon={AlertTriangle} label="Errors (24h)" value={errorsLast24h} sub={errorsLast24h > 0 ? "check the Errors tab" : "all clear"} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TrendBars data={stats.signupsByDay} label="Signups — last 14 days" />
        <TrendBars data={stats.messagesByDay} label="Messages — last 14 days" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-white/10 dark:bg-white/5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">Users by role</h3>
          <ul className="flex flex-col gap-1.5 text-sm">
            {stats.usersByRole.map((r) => (
              <li key={r.role} className="flex justify-between text-neutral-600 dark:text-neutral-300">
                <span>{r.role}</span>
                <span className="font-medium">{r.count}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-white/10 dark:bg-white/5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">Sign-in method</h3>
          <ul className="flex flex-col gap-1.5 text-sm">
            {stats.usersByProvider.map((p) => (
              <li key={p.provider} className="flex justify-between text-neutral-600 dark:text-neutral-300">
                <span className="capitalize">{p.provider}</span>
                <span className="font-medium">{p.count}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
