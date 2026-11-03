import Link from "next/link";
import { load, pageContext } from "@/app/page-utils";
import { Card, PageHeader, Table, Td, formatDateTime } from "@/components/ui";
import { ModuleForm, SelectField } from "@/components/module-forms";
import { getCertificates } from "@/server/services/operations";
import { getClubContext } from "@/server/services/clubs";
import { listEvents } from "@/server/services/events";
export default async function CertificatesPage({
  params,
}: PageProps<"/o/[slug]/certificates">) {
  const { slug } = await params,
    { db, actor } = await pageContext();
  const certificates = await load(getCertificates(db, actor, slug)),
    club = await load(getClubContext(db, actor, slug));
  const events = await listEvents(db, actor, slug, "all");
  return (
    <>
      <PageHeader
        title="Certificates"
        description="Attendance certificates with public verification codes."
      />
      {club.permissions.has("certificate.issue") ? (
        <Card className="mb-6">
          <ModuleForm
            slug={slug}
            operation="certificates"
            label="Issue certificates"
          >
            <SelectField
              name="eventId"
              label="Completed event"
              items={events
                .filter((e) => e.status === "completed")
                .map((e) => ({ id: e.id, name: e.title }))}
            />
          </ModuleForm>
        </Card>
      ) : null}
      <Table head={["Recipient", "Event", "Issued", "Certificate"]}>
        {certificates.map((c) => (
          <tr key={c.id}>
            <Td>{c.recipientName}</Td>
            <Td>{c.eventTitle}</Td>
            <Td>{formatDateTime(c.issuedAt)}</Td>
            <Td>
              <Link
                href={`/verify/${c.verificationCode}`}
                className="underline"
              >
                View / print
              </Link>
            </Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
