import { load, pageContext } from "@/app/page-utils";
import { Card, PageHeader, Table, Td, Badge } from "@/components/ui";
import {
  ModuleForm,
  TextField,
  SelectField,
  BodyField,
} from "@/components/module-forms";
import { getCtf } from "@/server/services/operations";
import { getClubContext } from "@/server/services/clubs";
import { listEvents } from "@/server/services/events";
export default async function CtfPage({ params }: PageProps<"/o/[slug]/ctf">) {
  const { slug } = await params,
    { db, actor } = await pageContext();
  const data = await load(getCtf(db, actor, slug)),
    club = await load(getClubContext(db, actor, slug));
  const events = await listEvents(db, actor, slug, "all");
  return (
    <>
      <PageHeader
        title="CTF"
        description="Solve challenges while the event is open. Publish write-ups after it ends."
      />
      {club.permissions.has("ctf.manage") ? (
        <Card className="mb-6">
          <h2 className="mb-3 font-semibold">New challenge</h2>
          <ModuleForm
            slug={slug}
            operation="challenge"
            label="Create challenge"
          >
            <SelectField
              name="eventId"
              label="CTF event"
              items={events
                .filter((e) => e.category === "ctf")
                .map((e) => ({ id: e.id, name: e.title }))}
            />
            <TextField name="title" label="Title" />
            <BodyField required />
            <TextField name="points" label="Points (1–10000)" type="number" />
            <TextField
              name="flag"
              label="Flag"
              type="password"
              maxLength={500}
            />
          </ModuleForm>
        </Card>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        {data.challenges.map((c) => {
          const mine = data.solves.find(
            (s) => s.challengeId === c.id && s.userId === actor.userId,
          );
          const event = events.find((e) => e.id === c.eventId);
          return (
            <Card key={c.id}>
              <h2 className="font-semibold">
                {c.title} <Badge>{c.points} points</Badge>
              </h2>
              <p className="my-2 text-xs text-zinc-500">{event?.title}</p>
              <p className="mb-4 whitespace-pre-wrap text-sm">
                {c.description}
              </p>
              {mine ? (
                <p className="mb-3 text-emerald-700">Solved</p>
              ) : (
                <ModuleForm slug={slug} operation="flag" label="Submit flag">
                  <input type="hidden" name="challengeId" value={c.id} />
                  <TextField name="flag" label="Your flag" maxLength={500} />
                </ModuleForm>
              )}
              {mine &&
              !mine.documentId &&
              event &&
              (event.status === "completed" || event.endsAt <= new Date()) ? (
                <ModuleForm
                  slug={slug}
                  operation="writeup"
                  label="Publish write-up"
                >
                  <input type="hidden" name="targetId" value={c.id} />
                  <BodyField name="body" label="Write-up" required />
                </ModuleForm>
              ) : null}
            </Card>
          );
        })}
      </div>
      <h2 className="my-4 font-semibold">Scoreboard</h2>
      <Table head={["Event", "Rank", "Participant", "Points"]}>
        {data.scoreboard.map((s) => (
          <tr key={`${s.eventId}-${s.userId}`}>
            <Td>{events.find((e) => e.id === s.eventId)?.title}</Td>
            <Td>{s.rank}</Td>
            <Td>
              {s.userId === actor.userId
                ? "You"
                : `Participant ${s.userId?.slice(0, 8)}`}
            </Td>
            <Td>{s.points}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
