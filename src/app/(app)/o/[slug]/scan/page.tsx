import Link from "next/link";
import { notFound } from "next/navigation";
import { load, pageContext } from "@/app/page-utils";
import { Card, EmptyState, PageHeader, cx, formatDateTime } from "@/components/ui";
import { getClubContext } from "@/server/services/clubs";
import { listEvents } from "@/server/services/events";
import { getInventory } from "@/server/services/operations";
import { Scanner } from "./scanner";

export default async function ScanPage({ params, searchParams }: PageProps<"/o/[slug]/scan">) {
  const { slug } = await params;
  const { event: selected, slot: selectedSlot } = await searchParams;
  const { actor, db } = await pageContext();
  const club = await load(getClubContext(db, actor, slug));
  const canMeals = club.features.inventory && club.permissions.has("food.distribute");
  if (!club.permissions.has("event.checkin") && !canMeals) notFound();
  const slots = canMeals ? (await load(getInventory(db, actor, slug))).slots : [];

  const open = (await listEvents(db, actor, slug, "upcoming")).filter((e) => e.status === "published");
  const current = open.find((e) => e.id === selected) ?? (open.length === 1 ? open[0] : undefined);

  const meal = slots.find((s) => s.id === selectedSlot && s.eventId === current?.id);

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
      {current ? <>
        <Card><h2 className="mb-3 font-medium">Scanner mode</h2><div className="flex flex-wrap gap-3">
          {club.permissions.has("event.checkin") ? <Link href={`/o/${slug}/scan?event=${current.id}`} className="underline">Check-in</Link> : null}
          {slots.filter((s) => s.eventId === current.id).map((s) => <Link key={s.id} href={`/o/${slug}/scan?event=${current.id}&slot=${s.id}`} className="underline">Meal: {s.name}</Link>)}
        </div></Card>
        {meal || club.permissions.has("event.checkin") ? <div><h2 className="mb-3 font-semibold">{meal ? `Meal: ${meal.name}` : "Attendance check-in"}</h2><Scanner key={`${current.id}-${meal?.id ?? "checkin"}`} slug={slug} eventId={current.id} slotId={meal?.id} /></div> : null}
      </> : null}
    </div>
  );
}
