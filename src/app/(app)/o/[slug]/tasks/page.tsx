import { load, pageContext } from "@/app/page-utils";
import { Card, PageHeader, Badge } from "@/components/ui";
import {
  ModuleForm,
  TextField,
  SelectField,
  BodyField,
} from "@/components/module-forms";
import { getTasks } from "@/server/services/operations";
import { getClubContext } from "@/server/services/clubs";
import { listEvents } from "@/server/services/events";
export default async function TasksPage({
  params,
}: PageProps<"/o/[slug]/tasks">) {
  const { slug } = await params,
    { db, actor } = await pageContext();
  const data = await load(getTasks(db, actor, slug)),
    club = await load(getClubContext(db, actor, slug));
  const manage = club.permissions.has("task.manage"),
    events = await listEvents(db, actor, slug, "all");
  return (
    <>
      <PageHeader
        title="Volunteer tasks"
        description="See your assignments and mark completed work."
      />
      {manage ? (
        <Card className="mb-6">
          <h2 className="mb-3 font-semibold">Create task</h2>
          <ModuleForm slug={slug} operation="task" label="Create task">
            <TextField name="title" label="Title" />
            <BodyField />
            <SelectField
              name="eventId"
              label="Event"
              optional
              items={events.map((e) => ({ id: e.id, name: e.title }))}
            />
            <TextField
              name="dueAt"
              label="Due at"
              type="datetime-local"
              required={false}
            />
          </ModuleForm>
        </Card>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        {data.tasks.map((t) => {
          const assigned = data.assignments.filter((a) => a.taskId === t.id);
          const mine = assigned.find(
            (a) =>
              data.members.find((m) => m.id === a.membershipId)?.userId ===
              actor.userId,
          );
          return (
            <Card key={t.id}>
              <h2 className="font-semibold">{t.title}</h2>
              <p className="my-2 whitespace-pre-wrap text-sm">
                {t.description}
              </p>
              {t.dueAt ? (
                <p className="text-sm">
                  Due: {t.dueAt.toLocaleString("en-IN")}
                </p>
              ) : null}
              {assigned.map((a) => (
                <p key={a.membershipId} className="my-2 text-sm">
                  {data.members.find((m) => m.id === a.membershipId)?.name ??
                    "Member"}{" "}
                  <Badge>{a.completedAt ? "Completed" : "Assigned"}</Badge>
                </p>
              ))}
              {mine && !mine.completedAt ? (
                <ModuleForm
                  slug={slug}
                  operation="complete"
                  label="Mark complete"
                >
                  <input type="hidden" name="taskId" value={t.id} />
                </ModuleForm>
              ) : null}
              {manage ? (
                <ModuleForm slug={slug} operation="assign" label="Assign">
                  <input type="hidden" name="taskId" value={t.id} />
                  <SelectField
                    name="membershipId"
                    label="Member"
                    items={data.members}
                  />
                </ModuleForm>
              ) : null}
            </Card>
          );
        })}
      </div>
    </>
  );
}
