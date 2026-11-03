import Link from "next/link";
import { withdrawRequest } from "@/app/actions";
import { pageContext } from "@/app/page-utils";
import { Badge, ButtonLink, Card, CardTitle, EmptyState, Notice, buttonClass, formatDateTime } from "@/components/ui";
import { listClubs } from "@/server/services/clubs";
import { listMyUpcomingEvents } from "@/server/services/events";
import { listMyRequests } from "@/server/services/memberships";

export const metadata = { title: "Dashboard · ClubSphere" };

const STATUS_TONE = { pending: "amber", approved: "green", rejected: "red", withdrawn: "neutral" } as const;

export default async function Dashboard({ searchParams }: PageProps<"/dashboard">) {
  const { actor, db } = await pageContext();
  const [clubs, requests, upcoming, params] = await Promise.all([
    listClubs(db, actor),
    listMyRequests(db, actor),
    listMyUpcomingEvents(db, actor),
    searchParams,
  ]);
  const myClubs = clubs.filter((c) => c.membership);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
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
