import { load, pageContext } from "@/app/page-utils";
import { manageMember } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, Field, PageHeader, inputClass } from "@/components/ui";
import { listMembers } from "@/server/services/memberships";

export default async function MembersPage({
  params,
}: PageProps<"/o/[slug]/members">) {
  const { slug } = await params;
  const { db, actor } = await pageContext();
  const data = await load(listMembers(db, actor, slug));
  return (
    <>
      <PageHeader
        title="Members"
        description="Membership status and roles in this club."
      />
      <div className="space-y-4">
        {data.members.map((m) => (
          <Card key={m.id}>
            <h2 className="font-semibold">
              {m.displayName} <Badge>{m.status}</Badge>
            </h2>
            <p className="text-sm text-zinc-500">{m.email}</p>
            <p className="my-2 text-sm">
              Roles:{" "}
              {data.roles
                .filter((r) => m.roleIds.includes(r.id))
                .map((r) => r.name)
                .join(", ") || "None"}
            </p>
            <div className="flex flex-wrap gap-4">
              {data.canSuspend ? (
                <ActionForm
                  action={manageMember.bind(null, slug, m.id)}
                  className="space-y-2"
                >
                  <input
                    type="hidden"
                    name="operation"
                    value={m.status === "active" ? "suspend" : "reinstate"}
                  />
                  {m.status === "active" ? (
                    <Field label="Suspension reason">
                      <input
                        name="reason"
                        maxLength={500}
                        className={inputClass}
                      />
                    </Field>
                  ) : null}
                  <SubmitButton variant="secondary" pendingLabel="Saving…">
                    {m.status === "active"
                      ? "Suspend member"
                      : "Reinstate member"}
                  </SubmitButton>
                </ActionForm>
              ) : null}
              {data.canAssign ? (
                <ActionForm
                  action={manageMember.bind(null, slug, m.id)}
                  className="space-y-2"
                >
                  <Field label="Role">
                    <select name="roleId" className={inputClass}>
                      {data.roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                          {m.roleIds.includes(r.id) ? " (assigned)" : ""}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Action">
                    <select name="operation" className={inputClass}>
                      <option value="assign">Assign</option>
                      <option value="revoke">Revoke</option>
                    </select>
                  </Field>
                  <SubmitButton variant="secondary" pendingLabel="Saving…">
                    Update role
                  </SubmitButton>
                </ActionForm>
              ) : null}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
