import Link from "next/link";
import { load, pageContext } from "@/app/page-utils";
import { PageHeader, Table, Td, formatDateTime } from "@/components/ui";
import { getAuditLog } from "@/server/services/administration";
export default async function AuditPage({
  params,
  searchParams,
}: PageProps<"/o/[slug]/audit">) {
  const { slug } = await params,
    query = await searchParams,
    { db, actor } = await pageContext();
  const rows = await load(
    getAuditLog(
      db,
      actor,
      slug,
      typeof query.before === "string" ? query.before : undefined,
    ),
  );
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Database-recorded changes. Newest first; 100 per page."
      />
      <Table head={["When", "Actor", "Action", "Target", "Details"]}>
        {rows.map((r) => (
          <tr key={r.id}>
            <Td>{formatDateTime(r.occurredAt)}</Td>
            <Td>{r.actorId ?? "System"}</Td>
            <Td>{r.action}</Td>
            <Td>
              {r.targetType} {r.targetId}
            </Td>
            <Td>
              <pre className="max-w-sm overflow-auto text-xs">
                {JSON.stringify(r.metadata, null, 2)}
              </pre>
            </Td>
          </tr>
        ))}
      </Table>
      {rows.length === 100 ? (
        <Link
          href={`/o/${slug}/audit?before=${rows.at(-1)!.id}`}
          className="my-4 inline-block underline"
        >
          Older entries
        </Link>
      ) : null}
    </>
  );
}
