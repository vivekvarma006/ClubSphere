import { Icon, type IconName } from "@/components/icons";
import { Card, CardTitle, EmptyState } from "@/components/ui";

export function Metric({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  const icon: IconName = /task|review|Awaiting/i.test(label) ? "bolt" : /certificate|approval/i.test(label) ? "award" : /member/i.test(label) ? "users" : "calendar";
  return <Card className="metric-card">
    <div className="flex items-center justify-between gap-2"><p className="text-xs font-medium text-zinc-400">{label}</p><span className="metric-icon"><Icon name={icon} /></span></div>
    <p className="mt-4 text-[32px] font-semibold leading-none tracking-tight tabular-nums">{value}</p>
    <p className="mt-3 text-xs text-zinc-500">{hint}</p>
  </Card>;
}

/** Server-rendered charts retain text values and need no client chart library. */
export function BarList({ title, rows, empty = "No data yet." }: {
  title: string; rows: { id: string; label: string; value: number; detail?: string }[]; empty?: string;
}) {
  const max = Math.max(1, ...rows.map(row => row.value));
  return <Card>
    <CardTitle>{title}</CardTitle>
    {rows.length ? <ul className="space-y-4">
      {rows.map(row => <li key={row.id}>
        <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
          <span className="min-w-0 break-words">{row.label}</span>
          <span className="shrink-0 font-medium tabular-nums">{row.value.toLocaleString("en-IN")}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" aria-hidden="true">
          <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${100 * row.value / max}%` }} />
        </div>
        {row.detail ? <p className="mt-1 text-xs text-zinc-500">{row.detail}</p> : null}
      </li>)}
    </ul> : <EmptyState>{empty}</EmptyState>}
  </Card>;
}

export function ApplicationTrend({ rows }: { rows: { month: string; applications: number; approved: number; rejected: number; stillPending: number }[] }) {
  const recent = rows.slice(-12);
  const max = Math.max(1, ...recent.map(row => row.applications));
  return <Card>
    <CardTitle>Application trend</CardTitle>
    <p className="mb-4 text-xs text-zinc-500">Up to 12 months with applications. Full history is in the table below.</p>
    {recent.length ? <ul className="space-y-4">
      {recent.map(row => <li key={row.month}>
        <div className="mb-1 flex justify-between gap-3 text-sm">
          <span>{new Date(`${row.month}T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" })}</span>
          <span className="tabular-nums">{row.applications} applications</span>
        </div>
        <div className="flex h-3 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" style={{ width: `${100 * row.applications / max}%` }} aria-hidden="true">
          <span className="bg-emerald-600" style={{ width: `${100 * row.approved / Math.max(1, row.applications)}%` }} />
          <span className="bg-red-500" style={{ width: `${100 * row.rejected / Math.max(1, row.applications)}%` }} />
          <span className="bg-amber-500" style={{ width: `${100 * row.stillPending / Math.max(1, row.applications)}%` }} />
        </div>
        <p className="mt-1 text-xs text-zinc-500">{row.approved} approved · {row.rejected} rejected · {row.stillPending} pending · {row.applications - row.approved - row.rejected - row.stillPending} withdrawn</p>
      </li>)}
    </ul> : <EmptyState>No applications yet.</EmptyState>}
    <div className="mt-4 flex flex-wrap gap-4 text-xs text-zinc-600 dark:text-zinc-400" aria-hidden="true">
      {[["bg-emerald-600", "Approved"], ["bg-red-500", "Rejected"], ["bg-amber-500", "Pending"], ["bg-zinc-200 dark:bg-zinc-700", "Withdrawn"]].map(([tone, label]) =>
        <span key={label} className="flex items-center gap-1.5"><span className={`h-2 w-2 rounded-sm ${tone}`} />{label}</span>)}
    </div>
  </Card>;
}

export function EventFill({ rows }: { rows: { eventId: string; title: string; capacity: number | null; registered: number; attended: number; status: string }[] }) {
  return <Card>
    <CardTitle>Event registration & attendance</CardTitle>
    <p className="mb-4 text-xs text-zinc-500">Up to 6 published or completed events from the 20 most recent events.</p>
    {rows.length ? <ul className="space-y-4">{rows.map(row => <li key={row.eventId}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 break-words">{row.title}</span>
        <span className="shrink-0 tabular-nums">{row.registered}{row.capacity !== null ? ` / ${row.capacity}` : " registered"}</span>
      </div>
      {row.capacity !== null ? <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" aria-hidden="true">
        <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.min(100, 100 * row.registered / row.capacity)}%` }} />
      </div> : null}
      <p className="mt-1 text-xs text-zinc-500">{row.attended} attended · {row.capacity === null ? "No capacity limit" : `${Math.round(100 * row.registered / row.capacity)}% filled`} · {row.status}</p>
    </li>)}</ul> : <EmptyState>No published events yet.</EmptyState>}
  </Card>;
}
