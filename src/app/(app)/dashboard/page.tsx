import { ActivityHeatmap } from "@/components/activity-heatmap";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Metric } from "@/components/report-visuals";
import { getMyActivity } from "@/server/services/activity";
import { changeWaitlistAction, withdrawRequest } from "@/app/actions";
import { pageContext } from "@/app/page-utils";
import { Badge, ButtonLink, Card, CardTitle, EmptyState, Notice, buttonClass, formatDateTime } from "@/components/ui";
import { listClubs } from "@/server/services/clubs";
import { listMyUpcomingEvents } from "@/server/services/events";
import { listMyRequests } from "@/server/services/memberships";

export const metadata = { title: "Dashboard · ClubSphere" };

const STATUS_TONE = { pending: "amber", approved: "green", rejected: "red", withdrawn: "neutral" } as const;

export default async function Dashboard({ searchParams }: PageProps<"/dashboard">) {
  const { actor, db } = await pageContext();
  const [clubs, requests, upcoming, params, activity] = await Promise.all([
    listClubs(db, actor),
    listMyRequests(db, actor),
    listMyUpcomingEvents(db, actor),
    searchParams,
    getMyActivity(db, actor),
  ]);
  const myClubs = clubs.filter((c) => c.membership);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow mb-2">Your club life, connected</p><h1 className="text-3xl font-semibold tracking-tight">My Activity</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Your clubs, registrations and next steps in one place.</p></div><ButtonLink href="/join" variant="secondary">Explore clubs ↗</ButtonLink></div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Upcoming registrations" value={activity.stats.upcoming} hint="Across your active clubs" />
        <Metric label="Tasks to complete" value={activity.stats.pendingTasks} hint="Assigned to you" />
        <Metric label="Events attended" value={activity.stats.attended} hint="Your recorded check-ins" />
        <Metric label="Certificates earned" value={activity.stats.certificates} hint="From clubs with certificates enabled" />
      </div>
      <ActivityHeatmap days={activity.calendar} />
      {params.requested ? <Notice tone="success">Request sent. A club officer will review it.</Notice> : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle aside={<ButtonLink href="/join" variant="secondary" size="sm">Browse clubs</ButtonLink>}>My clubs</CardTitle>
          {myClubs.length === 0 ? (
            <EmptyState>You are not a member of any club yet. Browse clubs to request membership.</EmptyState>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {myClubs.map((c) => (
                <li key={c.slug}>
                  <Link
                    href={`/o/${c.slug}`}
                    className="block rounded-lg border border-zinc-200 p-4 transition hover:shadow dark:border-zinc-800"
                    style={{ borderLeft: `4px solid ${c.primaryColor ?? "var(--accent)"}` }}
                  >
                    <span className="font-medium">{c.name}</span>
                    <span className="mt-1 block">
                      {c.membership === "active" ? <Badge tone="green">Member</Badge> : <Badge tone="red">Suspended</Badge>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>My upcoming events</CardTitle>
          {upcoming.length === 0 ? (
            <EmptyState>No upcoming registrations.</EmptyState>
          ) : (
            <ul className="space-y-3">
              {upcoming.map((e) => (
                <li key={e.eventId}>
                  <Link href={`/o/${e.organizationSlug}/events/${e.eventId}`} className="block rounded-lg p-2 hover:bg-zinc-50 dark:hover:bg-zinc-800">
                    <span className="block text-sm font-medium">{e.title}</span>
                    <span className="block text-xs text-zinc-500">
                      {formatDateTime(e.startsAt)} · {e.organizationName}
                    </span>
                    <span className="mt-1 block">{e.checkedIn ? <Badge tone="green">Checked in</Badge> : <Badge tone="blue">Show QR</Badge>}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>Tasks to complete</CardTitle>
          {activity.tasks.length ? <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {activity.tasks.map(task => <li key={task.id} className="py-3">
              <Link href={`/o/${task.slug}/tasks`} className="text-sm font-medium hover:underline">{task.title}</Link>
              <p className="mt-1 text-xs text-zinc-500">{task.organizationName} · {task.dueAt ? `Due ${formatDateTime(task.dueAt)}` : "No due date"}</p>
            </li>)}
          </ul> : <EmptyState>You have no outstanding tasks.</EmptyState>}
          {activity.stats.pendingTasks > activity.tasks.length ? <p className="mt-3 text-xs text-zinc-500">Showing the next {activity.tasks.length} tasks. Open a club&apos;s Tasks page to see all assignments.</p> : null}
        </Card>
        <Card>
          <CardTitle>My waitlists</CardTitle>
          {activity.waitlists.length ? <ul className="space-y-4">
            {activity.waitlists.map(event => <li key={event.id} className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0"><Link href={`/o/${event.slug}/events/${event.id}`} className="text-sm font-medium hover:underline">{event.title}</Link>
                <p className="mt-1 text-xs text-zinc-500">{event.organizationName} · {formatDateTime(event.startsAt)}</p>
                <Badge tone="amber">Position #{event.position}</Badge></div>
              <ActionForm action={changeWaitlistAction.bind(null, event.slug, event.id, "leave")}>
                <SubmitButton variant="secondary" pendingLabel="Leaving...">Leave waitlist</SubmitButton>
              </ActionForm>
            </li>)}
          </ul> : <EmptyState>You are not waiting for any event places.</EmptyState>}
          <p className="mt-3 text-xs text-zinc-500">Shows up to 8 upcoming waitlists. When a place opens, your event appears under My upcoming events.</p>
        </Card>
        <Card>
          <CardTitle>Recent participation</CardTitle>
          {activity.recent.length ? <ul className="space-y-3">{activity.recent.map(event => <li key={event.id}>
            <Link href={`/o/${event.slug}/events/${event.id}`} className="text-sm font-medium hover:underline">{event.title}</Link>
            <p className="mt-1 text-xs text-zinc-500">{event.organizationName} · Checked in {formatDateTime(event.checkedInAt)}</p>
          </li>)}</ul> : <EmptyState>Your event check-ins will appear here.</EmptyState>}
        </Card>
        <Card>
          <CardTitle>Recent certificates</CardTitle>
          {activity.certificates.length ? <ul className="space-y-3">{activity.certificates.map(certificate => <li key={certificate.id}>
            <Link href={`/verify/${certificate.code}`} className="text-sm font-medium hover:underline">{certificate.title}</Link>
            <p className="mt-1 text-xs text-zinc-500">{certificate.organizationName} · Issued {formatDateTime(certificate.issuedAt)}</p>
          </li>)}</ul> : <EmptyState>Certificates issued to you will appear here.</EmptyState>}
        </Card>
      </div>

      <Card>
        <CardTitle>My membership requests</CardTitle>
        {requests.length === 0 ? (
          <EmptyState>No requests yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {requests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <span className="font-medium">{r.organizationName}</span>
                  <span className="ml-2">
                    <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                  </span>
                  <span className="block text-xs text-zinc-500">
                    Applied {formatDateTime(r.appliedAt)}
                    {r.reviewedAt ? ` · reviewed ${formatDateTime(r.reviewedAt)}` : ""}
                  </span>
                  {r.rejectionReason ? <span className="block text-xs text-zinc-600 dark:text-zinc-400">Reason: {r.rejectionReason}</span> : null}
                </div>
                {r.status === "pending" ? (
                  <form action={withdrawRequest.bind(null, r.id)}>
                    <button type="submit" className={buttonClass("secondary", "sm")}>
                      Withdraw
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
