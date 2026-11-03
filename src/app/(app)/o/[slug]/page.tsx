import Link from "next/link";
import { load, pageContext } from "@/app/page-utils";
import { Badge, ButtonLink, Card, CardTitle, EmptyState, formatDateTime } from "@/components/ui";
import { PERMISSIONS } from "@/server/authz/permissions";
import { getClubContext } from "@/server/services/clubs";
import { listEvents } from "@/server/services/events";
import { listPendingRequests } from "@/server/services/memberships";

const PERMISSION_LABELS: Record<(typeof PERMISSIONS)[number], string> = {
  "org.settings.manage": "Manage club settings",
  "member.read": "See members",
  "membership.review": "Review membership requests",
  "membership.suspend": "Suspend members",
  "role.assign": "Assign roles",
  "role.manage": "Manage roles",
  "audit.read": "Read audit log",
  "analytics.read": "View reports",
  "event.manage": "Manage events",
  "event.checkin": "Scan QR check-ins",
  "document.manage": "Publish documents",
  "food.distribute": "Distribute meals",
  "inventory.manage": "Manage inventory",
  "task.manage": "Manage volunteer tasks",
  "ctf.manage": "Manage CTF challenges",
  "certificate.issue": "Issue certificates",
};

export default async function ClubOverview({ params }: PageProps<"/o/[slug]">) {
  const { slug } = await params;
  const { actor, db } = await pageContext();
  const club = await load(getClubContext(db, actor, slug));
  const upcoming = (await listEvents(db, actor, slug, "upcoming")).slice(0, 4);
  const pending = club.permissions.has("membership.review")
    ? (await listPendingRequests(db, actor, { organizationSlug: slug, limit: 100 })).items.length
    : null;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardTitle aside={<ButtonLink href={`/o/${slug}/events`} variant="secondary" size="sm">All events</ButtonLink>}>Coming up</CardTitle>
        {upcoming.length === 0 ? (
          <EmptyState>No upcoming events.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {upcoming.map((e) => (
              <li key={e.id} className="py-3">
                <Link href={`/o/${slug}/events/${e.id}`} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <span className="block font-medium">{e.title}</span>
                    <span className="block text-xs text-zinc-500">
                      {formatDateTime(e.startsAt)}
                      {e.venue ? ` · ${e.venue}` : ""}
                    </span>
                  </span>
                  <span className="flex gap-1">
                    {e.status === "draft" ? <Badge tone="amber">Draft</Badge> : null}
                    {e.myRegistration === "registered" ? <Badge tone="green">Registered</Badge> : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="space-y-6">
        {pending !== null ? (
          <Card>
            <CardTitle>Membership requests</CardTitle>
            <p className="text-3xl font-semibold">{pending}</p>
            <p className="mb-3 text-sm text-zinc-500">waiting for review</p>
            <ButtonLink href={`/o/${slug}/review`} size="sm">
              Review
            </ButtonLink>
          </Card>
        ) : null}
        <Card>
          <CardTitle>What you can do here</CardTitle>
          {club.permissions.size === 0 ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Member: register for events, show your QR code, search the knowledge base.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {PERMISSIONS.filter((p) => club.permissions.has(p)).map((p) => (
                <li key={p}>
                  <Badge tone="blue">{PERMISSION_LABELS[p]}</Badge>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-zinc-500">Permissions come from your roles in this club only.</p>
        </Card>
      </div>
    </div>
  );
}
