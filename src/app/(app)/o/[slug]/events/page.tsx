import Link from "next/link";
import { load, pageContext } from "@/app/page-utils";
import { Badge, ButtonLink, Card, EmptyState, PageHeader, formatDateTime } from "@/components/ui";
import { getClubContext } from "@/server/services/clubs";
import { listEvents, type EventSummary } from "@/server/services/events";

const STATUS_TONE = { draft: "amber", published: "blue", completed: "neutral", cancelled: "red" } as const;

function EventRow({ slug, e }: { slug: string; e: EventSummary }) {
  const full = e.capacity !== null && e.registered >= e.capacity;
  return (
    <li className="py-3">
      <Link href={`/o/${slug}/events/${e.id}`} className="flex flex-wrap items-center justify-between gap-3">
        <span>
          <span className="block font-medium">{e.title}</span>
          <span className="block text-xs text-zinc-500">
            {formatDateTime(e.startsAt)}
            {e.venue ? ` · ${e.venue}` : ""} · {e.category}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-zinc-500">
            {e.registered}
            {e.capacity !== null ? ` / ${e.capacity}` : ""} registered
          </span>
          {e.status !== "published" ? <Badge tone={STATUS_TONE[e.status]}>{e.status}</Badge> : null}
          {full && e.status === "published" ? <Badge tone="red">Full</Badge> : null}
          {e.myRegistration === "registered" ? <Badge tone="green">You&apos;re registered</Badge> : null}
        </span>
      </Link>
    </li>
  );
}

export default async function EventsPage({ params }: PageProps<"/o/[slug]/events">) {
  const { slug } = await params;
  const { actor, db } = await pageContext();
  const club = await load(getClubContext(db, actor, slug));
  const [upcoming, past] = await Promise.all([listEvents(db, actor, slug, "upcoming"), listEvents(db, actor, slug, "past")]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Events"
        actions={club.permissions.has("event.manage") ? <ButtonLink href={`/o/${slug}/events/new`}>New event</ButtonLink> : null}
      />
      <Card>
        <h2 className="mb-1 font-semibold">Upcoming and live</h2>
        {upcoming.length === 0 ? (
          <EmptyState>No upcoming events.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {upcoming.map((e) => (
              <EventRow key={e.id} slug={slug} e={e} />
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <h2 className="mb-1 font-semibold">Past</h2>
        {past.length === 0 ? (
          <EmptyState>No past events.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {past.map((e) => (
              <EventRow key={e.id} slug={slug} e={e} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
