import { notFound } from "next/navigation";
import { createEventAction } from "@/app/actions";
import { load, pageContext } from "@/app/page-utils";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { getClubContext } from "@/server/services/clubs";
import { EVENT_CATEGORIES } from "@/server/services/events";

export default async function NewEventPage({ params }: PageProps<"/o/[slug]/events/new">) {
  const { slug } = await params;
  const { actor, db } = await pageContext();
  const club = await load(getClubContext(db, actor, slug));
  if (!club.permissions.has("event.manage")) notFound();

  return (
    <div className="max-w-2xl">
      <PageHeader title="New event" description="Drafts are visible only to event managers until published." />
      <Card>
        <ActionForm action={createEventAction.bind(null, slug)} className="space-y-4">
          <Field label="Title">
            <input name="title" required minLength={3} maxLength={120} className={inputClass} />
          </Field>
          <Field label="Description">
            <textarea name="description" rows={4} maxLength={5000} className={inputClass} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category">
              <select name="category" className={inputClass} defaultValue="workshop">
                {EVENT_CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Venue">
              <input name="venue" maxLength={200} className={inputClass} />
            </Field>
            <Field label="Starts">
              <input name="startsAt" type="datetime-local" required className={inputClass} />
            </Field>
            <Field label="Ends">
              <input name="endsAt" type="datetime-local" required className={inputClass} />
            </Field>
            <Field label="Capacity" hint="Leave empty for unlimited.">
              <input name="capacity" type="number" min={1} max={100000} className={inputClass} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="publish" /> Publish now (members can register)
          </label>
          <SubmitButton pendingLabel="Creating...">Create event</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
