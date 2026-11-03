import { load, pageContext } from "@/app/page-utils";
import { Card, PageHeader, Table, Td } from "@/components/ui";
import { ModuleForm, SelectField, BodyField } from "@/components/module-forms";
import { getFeedback } from "@/server/services/operations";
import { listEvents } from "@/server/services/events";
export default async function FeedbackPage({
  params,
}: PageProps<"/o/[slug]/feedback">) {
  const { slug } = await params,
    { db, actor } = await pageContext();
  const feedback = await load(getFeedback(db, actor, slug));
  const events = await listEvents(db, actor, slug, "all");
  return (
    <>
      <PageHeader
        title="Event feedback"
        description="One response per attended, completed event. Comments are shared in the club knowledge base."
      />
      <Card className="mb-6">
        <ModuleForm slug={slug} operation="feedback" label="Publish feedback">
          <SelectField
            name="targetId"
            label="Completed event"
            items={events
              .filter((e) => e.status === "completed")
              .map((e) => ({ id: e.id, name: e.title }))}
          />
          <SelectField
            name="rating"
            label="Rating"
            items={[1, 2, 3, 4, 5].map((n) => ({
              id: String(n),
              name: `${n} / 5`,
            }))}
          />
          <BodyField
            name="body"
            label="Comment (shared with club members)"
            required
          />
        </ModuleForm>
      </Card>
      <Table head={["Event", "Rating", "Comment"]}>
        {feedback.map((f) => (
          <tr key={f.id}>
            <Td>{events.find((e) => e.id === f.eventId)?.title}</Td>
            <Td>{f.rating} / 5</Td>
            <Td>{f.comment}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
