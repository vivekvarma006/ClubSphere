import { reviewRequest } from "@/app/actions";
import { load, pageContext } from "@/app/page-utils";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, EmptyState, PageHeader, formatDateTime, inputClass } from "@/components/ui";
import { listPendingRequests } from "@/server/services/memberships";

export default async function ReviewPage({ params }: PageProps<"/o/[slug]/review">) {
  const { slug } = await params;
  const { actor, db } = await pageContext();
  const { items } = await load(listPendingRequests(db, actor, { organizationSlug: slug, limit: 50 }));

  return (
    <div>
      <PageHeader
        title="Membership requests"
        description="Oldest first. Approving creates the membership with the club's default role; every decision is written to the audit log."
      />
      {items.length === 0 ? (
        <EmptyState>Nothing to review.</EmptyState>
      ) : (
        <div className="space-y-4">
          {items.map((r) => (
            <Card key={r.id}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="font-medium">{r.displayName}</p>
                  <p className="text-xs text-zinc-500">
                    {r.email} · applied {formatDateTime(r.appliedAt)}
                  </p>
                  {Object.keys(r.answers).length > 0 ? (
                    <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                      {Object.entries(r.answers).map(([key, value]) => (
                        <div key={key} className="contents">
                          <dt className="text-zinc-500">{key.replace(/_/g, " ")}</dt>
                          <dd>{String(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </div>
                <div className="flex w-full flex-col gap-2 sm:w-72">
                  <ActionForm action={reviewRequest.bind(null, slug, r.id, "approve")}>
                    <SubmitButton className="w-full" pendingLabel="Approving...">
                      Approve
                    </SubmitButton>
                  </ActionForm>
                  <ActionForm action={reviewRequest.bind(null, slug, r.id, "reject")} className="flex gap-2">
                    <input name="reason" placeholder="Reason (optional)" maxLength={500} className={inputClass} />
                    <SubmitButton variant="secondary" pendingLabel="...">
                      Reject
                    </SubmitButton>
                  </ActionForm>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
