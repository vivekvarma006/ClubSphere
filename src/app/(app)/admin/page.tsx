import { load, pageContext } from "@/app/page-utils";
import { administrationAction } from "@/app/admin-actions";
import {
  Card,
  PageHeader,
  Field,
  inputClass,
  Table,
  Td,
} from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { TextField } from "@/components/module-forms";
import { listAdminClubs } from "@/server/services/administration";
export default async function AdminPage() {
  const { db, actor } = await pageContext(),
    clubs = await load(listAdminClubs(db, actor));
  return (
    <>
      <PageHeader
        title="Platform administration"
        description="Create clubs and suspend or restore their availability."
      />
      <Card className="mb-6">
        <ActionForm
          action={administrationAction.bind(null, "", "club")}
          className="space-y-3"
        >
          <TextField name="slug" label="Club slug" />
          <TextField name="name" label="Club name" />
          <TextField
            name="ownerId"
            label="Verified initial owner’s profile ID"
          />
          <SubmitButton pendingLabel="Creating…">Create club</SubmitButton>
        </ActionForm>
      </Card>
      <Table head={["Club", "Status", "Availability"]}>
        {clubs.map((c) => (
          <tr key={c.id}>
            <Td>
              {c.name} ({c.slug})
            </Td>
            <Td>{c.status}</Td>
            <Td>
              <ActionForm
                action={administrationAction.bind(null, "", "status")}
                className="flex flex-wrap gap-2"
              >
                <input type="hidden" name="organizationId" value={c.id} />
                <Field label="New status">
                  <select
                    name="status"
                    defaultValue={
                      c.status === "active" ? "suspended" : "active"
                    }
                    className={inputClass}
                  >
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </Field>
                <SubmitButton variant="secondary" pendingLabel="Saving…">
                  Update
                </SubmitButton>
              </ActionForm>
            </Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
