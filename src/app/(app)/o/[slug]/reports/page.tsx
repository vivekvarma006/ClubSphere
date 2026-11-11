import { ActivityHeatmap } from "@/components/activity-heatmap";
import { load, pageContext } from "@/app/page-utils";
import { Card, CardTitle, EmptyState, PageHeader, Table, Td, formatDate } from "@/components/ui";
import { ApplicationTrend, BarList, EventFill, Metric } from "@/components/report-visuals";
import { getMembershipReports } from "@/server/services/reports";

const pct = (value: string | null) => (value === null ? "-" : `${value}%`);
const hours = (value: string | null) => (value === null ? "-" : `${value} h`);

/**
 * Reports straight from the security_invoker SQL views. The same views run
 * by another club's owner return only that club's figures (RLS).
 */
export default async function ReportsPage({ params }: PageProps<"/o/[slug]/reports">) {
  const { slug } = await params;
  const { actor, db } = await pageContext();
  const r = await load(getMembershipReports(db, actor, slug));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Membership, application trends and event participation for this club. Updated when you open this page."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Active members" value={r.summary?.activeMembers ?? 0} hint="Current active memberships" />
        <Metric label="Awaiting review" value={r.summary?.pendingRequests ?? 0} hint="Membership requests still pending" />
        <Metric label="Approval rate" value={r.summary?.approvalRatePct !== null && r.summary?.approvalRatePct !== undefined ? `${r.summary.approvalRatePct}%` : "—"} hint="Approved share of reviewed requests" />
        <Metric label="Average review time" value={r.turnaround?.avgHoursToReview != null ? `${r.turnaround.avgHoursToReview} h` : "—"} hint={`${r.turnaround?.reviewedRequests ?? 0} reviewed requests`} />
      </div>
      <ActivityHeatmap days={r.calendar} club />
      <div className="grid gap-6 lg:grid-cols-2">
        <ApplicationTrend rows={r.monthly} />
        <EventFill rows={r.events.filter(e => e.status === "published" || e.status === "completed").slice(0, 6)} />
      </div>
      <BarList title="Active members by role" rows={r.roles.map(role => ({ id: role.roleKey, label: role.roleName, value: role.activeMembers }))} />
      <p className="text-xs text-zinc-500">Members may hold multiple roles. Figures reflect the records your permissions allow you to view.</p>

      <Card>
        <CardTitle>Membership details</CardTitle>
        {r.summary ? (
          <Table head={["Active members", "Suspended", "Pending", "Approved", "Rejected", "Approval rate"]}>
            <tr>
              <Td>{r.summary.activeMembers}</Td>
              <Td>{r.summary.suspendedMembers}</Td>
              <Td>{r.summary.pendingRequests}</Td>
              <Td>{r.summary.approvedRequests}</Td>
              <Td>{r.summary.rejectedRequests}</Td>
              <Td>{pct(r.summary.approvalRatePct)}</Td>
            </tr>
          </Table>
        ) : (
          <EmptyState>No data.</EmptyState>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>Review turnaround</CardTitle>
          {r.turnaround ? (
            <Table head={["Reviewed", "Average", "Median", "Longest"]}>
              <tr>
                <Td>{r.turnaround.reviewedRequests}</Td>
                <Td>{hours(r.turnaround.avgHoursToReview)}</Td>
                <Td>{hours(r.turnaround.medianHoursToReview)}</Td>
                <Td>{hours(r.turnaround.maxHoursToReview)}</Td>
              </tr>
            </Table>
          ) : (
            <EmptyState>No reviewed requests yet.</EmptyState>
          )}
        </Card>

        <Card>
          <CardTitle>Role details</CardTitle>
          <Table head={["Role", "Active members"]}>
            {r.roles.map((role) => (
              <tr key={role.roleKey}>
                <Td>{role.roleName}</Td>
                <Td>{role.activeMembers}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      <Card>
        <CardTitle>Event attendance details</CardTitle>
        {r.events.length === 0 ? (
          <EmptyState>No events yet.</EmptyState>
        ) : (
          <Table head={["Event", "Date", "Status", "Capacity", "Registered", "Attended", "Attendance rate", "Fill rate"]}>
            {r.events.map((e) => (
              <tr key={e.eventId}>
                <Td className="font-medium">{e.title}</Td>
                <Td>{formatDate(e.startsAt)}</Td>
                <Td>{e.status}</Td>
                <Td>{e.capacity ?? "∞"}</Td>
                <Td>{e.registered}</Td>
                <Td>{e.attended}</Td>
                <Td>{pct(e.attendanceRatePct)}</Td>
                <Td>{pct(e.fillRatePct)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card>
        <CardTitle>Applications per month</CardTitle>
        <Table head={["Month", "Applications", "Approved", "Rejected", "Still pending"]}>
          {r.monthly.map((m) => (
            <tr key={m.month}>
              <Td>{new Date(m.month).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</Td>
              <Td>{m.applications}</Td>
              <Td>{m.approved}</Td>
              <Td>{m.rejected}</Td>
              <Td>{m.stillPending}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
