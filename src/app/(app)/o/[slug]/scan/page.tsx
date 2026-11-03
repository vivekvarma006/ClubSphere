import Link from "next/link";
import { notFound } from "next/navigation";
import { load, pageContext } from "@/app/page-utils";
import { Card, EmptyState, PageHeader, cx, formatDateTime } from "@/components/ui";
import { getClubContext } from "@/server/services/clubs";
import { listEvents } from "@/server/services/events";
import { Scanner } from "./scanner";

export default async function ScanPage({ params, searchParams }: PageProps<"/o/[slug]/scan">) {
  const { slug } = await params;
  const { event: selected } = await searchParams;
  const { actor, db } = await pageContext();
  const club = await load(getClubContext(db, actor, slug));
  if (!club.permissions.has("event.checkin")) notFound();

  const open = (await listEvents(db, actor, slug, "upcoming")).filter((e) => e.status === "published");
  const current = open.find((e) => e.id === selected) ?? (open.length === 1 ? open[0] : undefined);

  return (
    <div className="space-y-6">
      <PageHeader title="QR check-in" description="Each code checks its owner in once. Codes from other events or other clubs are refused." />
      {open.length === 0 ? (
        <EmptyState>No published events to check people in to.</EmptyState>
      ) : (
        <Card>
          <p className="mb-2 text-sm font-medium">Event</p>
          <div className="flex flex-wrap gap-2">
            {open.map((e) => (
              <Link
                key={e.id}
                href={`/o/${slug}/scan?event=${e.id}`}
                className={cx(
                  "rounded-lg border px-3 py-2 text-sm",
                  current?.id === e.id ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-zinc-300 dark:border-zinc-700",
                )}
              >
                {e.title}
                <span className="block text-xs opacity-80">{formatDateTime(e.startsAt)}</span>
              </Link>
            ))}
          </div>
        </Card>
      )}
      {current ? <Scanner key={current.id} slug={slug} eventId={current.id} /> : null}
    </div>
  );
}
