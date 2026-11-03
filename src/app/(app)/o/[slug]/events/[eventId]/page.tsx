import {
  cancelRegistrationAction,
  manualCheckInAction,
  registerForEventAction,
  setEventStatusAction,
} from "@/app/actions";
import { load, pageContext } from "@/app/page-utils";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, ButtonLink, Card, CardTitle, EmptyState, PageHeader, Table, Td, formatDateTime } from "@/components/ui";
import { qrSvg } from "@/server/qr";
import { getEvent } from "@/server/services/events";

const STATUS_TONE = { draft: "amber", published: "blue", completed: "neutral", cancelled: "red" } as const;

export default async function EventPage({ params }: PageProps<"/o/[slug]/events/[eventId]">) {
  const { slug, eventId } = await params;
  const { actor, db } = await pageContext();
  const detail = await load(getEvent(db, actor, slug, eventId));
  const { event, mine, ended } = detail;
  const full = event.capacity !== null && detail.registered >= event.capacity;
  const qr = mine?.token ? await qrSvg(mine.token) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={event.title}
        description={
          <>
            {formatDateTime(event.startsAt)} to {formatDateTime(event.endsAt)}
            {event.venue ? ` · ${event.venue}` : ""} · {event.category}
          </>
        }
        actions={
          <>
            <Badge tone={STATUS_TONE[event.status]}>{event.status}</Badge>
            {detail.canCheckIn && event.status === "published" ? (
              <ButtonLink href={`/o/${slug}/scan?event=${event.id}`} size="sm">
                Open scanner
              </ButtonLink>
            ) : null}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle>About</CardTitle>
          <p className="whitespace-pre-line text-sm text-zinc-700 dark:text-zinc-300">{event.description || "No description."}</p>
          <p className="mt-4 text-sm text-zinc-500">
            {detail.registered} registered{event.capacity !== null ? ` of ${event.capacity} places` : ""}
          </p>
        </Card>

        <Card>
          <CardTitle>Your registration</CardTitle>
          {mine?.status === "registered" ? (
            <div className="space-y-3">
              {mine.checkedInAt ? (
                <Badge tone="green">Checked in {formatDateTime(mine.checkedInAt)}</Badge>
              ) : (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">Show this code at the entrance.</p>
              )}
              {qr ? (
                <div
                  className="mx-auto w-56 rounded-lg border border-zinc-200 bg-white p-2"
                  aria-label="Your check-in QR code"
                  role="img"
                  // SVG produced on the server by the qrcode library from a hex token.
                  dangerouslySetInnerHTML={{ __html: qr }}
                />
              ) : null}
              {mine.token ? (
                <details className="text-xs text-zinc-500">
                  <summary className="cursor-pointer">Code as text</summary>
                  <code className="break-all">{mine.token}</code>
                </details>
              ) : null}
              {!mine.checkedInAt && !ended ? (
                <ActionForm action={cancelRegistrationAction.bind(null, slug, mine.registrationId)}>
                  <SubmitButton variant="secondary" size="sm" pendingLabel="Cancelling...">
                    Cancel registration
                  </SubmitButton>
                </ActionForm>
              ) : null}
            </div>
          ) : event.status === "published" && !ended ? (
            full ? (
              <p className="text-sm text-zinc-600">This event is full.</p>
            ) : (
              <ActionForm action={registerForEventAction.bind(null, slug, event.id)}>
                <SubmitButton pendingLabel="Registering...">Register</SubmitButton>
              </ActionForm>
            )
          ) : (
            <p className="text-sm text-zinc-500">Registration is closed.</p>
          )}
        </Card>
      </div>

      {detail.canManage ? (
        <Card>
          <CardTitle>Manage</CardTitle>
          <div className="flex flex-wrap gap-2">
            {event.status === "draft" ? (
              <ActionForm action={setEventStatusAction.bind(null, slug, event.id, "published")}>
                <SubmitButton size="sm">Publish</SubmitButton>
              </ActionForm>
            ) : null}
            {event.status === "published" ? (
              <>
                <ActionForm action={setEventStatusAction.bind(null, slug, event.id, "completed")}>
                  <SubmitButton size="sm" variant="secondary">
                    Mark completed
                  </SubmitButton>
                </ActionForm>
                <ActionForm action={setEventStatusAction.bind(null, slug, event.id, "cancelled")}>
                  <SubmitButton size="sm" variant="danger">
                    Cancel event
                  </SubmitButton>
                </ActionForm>
              </>
            ) : null}
          </div>
        </Card>
      ) : null}

      {detail.registrants ? (
        <Card>
          <CardTitle aside={<span className="text-xs text-zinc-500">{detail.registrants.filter((r) => r.checkedInAt).length} checked in</span>}>
            Registrations
          </CardTitle>
          {detail.registrants.length === 0 ? (
            <EmptyState>No registrations yet.</EmptyState>
          ) : (
            <Table head={["Name", "Registered", "Status", ""]}>
              {detail.registrants.map((r) => (
                <tr key={r.registrationId}>
                  <Td>{r.displayName}</Td>
                  <Td className="text-zinc-500">{formatDateTime(r.registeredAt)}</Td>
                  <Td>
                    {r.status === "cancelled" ? (
                      <Badge tone="red">Cancelled</Badge>
                    ) : r.checkedInAt ? (
                      <Badge tone="green">Checked in {formatDateTime(r.checkedInAt)}</Badge>
                    ) : (
                      <Badge>Not yet</Badge>
                    )}
                  </Td>
                  <Td className="text-right">
                    {detail.canManage && r.status === "registered" && !r.checkedInAt && event.status === "published" ? (
                      <ActionForm action={manualCheckInAction.bind(null, slug, r.registrationId)}>
                        <SubmitButton size="sm" variant="secondary">
                          Check in manually
                        </SubmitButton>
                      </ActionForm>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      ) : null}
    </div>
  );
}
