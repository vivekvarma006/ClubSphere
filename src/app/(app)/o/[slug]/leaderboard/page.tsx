import { load, pageContext } from "@/app/page-utils";
import { Card, CardTitle, EmptyState, PageHeader, Table, Td, formatDateTime } from "@/components/ui";
import { getContributionReport } from "@/server/services/contribution-report";

export default async function LeaderboardPage({ params }: PageProps<"/o/[slug]/leaderboard">) {
  const { slug } = await params;
  const { db, actor } = await pageContext();
  const report = await load(getContributionReport(db, actor, slug));
  const s = report.summary;
  const participation = s.members ? Math.round(100 * s.contributors / s.members) : 0;
  return (
    <div className="space-y-6">
      <PageHeader title="Contribution report"
        description="See who is participating, recognize contributions, and identify members who may need an invitation to get involved." />
      <p className="text-sm text-zinc-500">All-time activity for current active members · Snapshot {formatDateTime(report.generatedAt)} · May take up to 30 seconds to reflect changes.</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[["Active members", s.members], ["Contributing members", s.contributors],
          ["Participation", `${participation}%`], ["No recorded contributions", s.inactive]].map(([label, value]) => (
          <Card key={label}><p className="text-sm text-zinc-500">{label}</p><p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p></Card>
        ))}
      </div>
      <Card>
        <CardTitle>Activity across the club</CardTitle>
        <Table head={["Event check-ins", "Completed tasks", "CTF points", "Certificates"]}>
          <tr>{[s.attendance, s.tasks, s.ctfPoints, s.certificates].map((n, i) => <Td key={i} className="tabular-nums">{n}</Td>)}</tr>
        </Table>
        <p className="mt-3 text-sm text-zinc-500">Check-ins count attendances, so one member attending three events contributes three. Participation means at least one recorded contribution; it is not a measure of recent activity.</p>
      </Card>
      <Card>
        <CardTitle>Member contributions</CardTitle>
        <p className="mb-4 text-sm text-zinc-500">Score = 10 × check-ins + 20 × completed tasks + CTF points + 5 × certificates. Equal scores share a rank.</p>
        {report.members.length ? <Table head={["Rank", "Member", "Attendance", "Tasks", "CTF points", "Certificates", "Score"]}>
          {report.members.map((r) => <tr key={r.userId}>
            <Td className="tabular-nums">{r.rank}</Td><Td className="font-medium">{r.displayName}</Td>
            {[r.attended, r.tasksCompleted, r.ctfPoints, r.certificates, r.score].map((n, i) => <Td key={i} className="tabular-nums">{n}</Td>)}
          </tr>)}
        </Table> : <EmptyState>No active members to report.</EmptyState>}
      </Card>
      <Card>
        <CardTitle>Members to engage</CardTitle>
        {s.inactive ? <>
          <p className="mb-3 text-sm text-zinc-500">These active members have no recorded contributions. Consider inviting them to an event or offering a volunteer task.</p>
          <ul className="flex flex-wrap gap-2">{report.members.filter((r) => r.score === 0).map((r) =>
            <li key={r.userId} className="rounded-lg bg-zinc-100 px-3 py-2 text-sm dark:bg-zinc-800">{r.displayName}</li>)}</ul>
        </> : <EmptyState>{s.members ? "Every active member has contributed." : "No active members yet."}</EmptyState>}
      </Card>
    </div>
  );
}
