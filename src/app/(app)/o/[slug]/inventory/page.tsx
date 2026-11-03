import { notFound } from "next/navigation";
import { load, pageContext } from "@/app/page-utils";
import { Card, PageHeader, Table, Td, formatDateTime } from "@/components/ui";
import { ModuleForm, TextField, SelectField } from "@/components/module-forms";
import { getInventory } from "@/server/services/operations";
import { getClubContext } from "@/server/services/clubs";
import { listEvents } from "@/server/services/events";
export default async function InventoryPage({
  params,
}: PageProps<"/o/[slug]/inventory">) {
  const { slug } = await params,
    { db, actor } = await pageContext();
  const club = await load(getClubContext(db, actor, slug));
  if (
    !club.permissions.has("inventory.manage") &&
    !club.permissions.has("food.distribute")
  )
    notFound();
  const { items, slots, movements } = await load(getInventory(db, actor, slug));
  const events = await load(listEvents(db, actor, slug, "all"));
  const eventItems = events.map((e) => ({ id: e.id, name: e.title }));
  return (
    <>
      <PageHeader
        title="Inventory & meals"
        description="Stock changes are recorded as movements. Each attendee can claim each meal once."
      />
      <Table head={["Item", "Available"]}>
        {items.map((i) => (
          <tr key={i.id}>
            <Td>{i.name}</Td>
            <Td>{i.quantity}</Td>
          </tr>
        ))}
      </Table>
      {club.permissions.has("inventory.manage") ? (
        <div className="my-6 grid gap-4 md:grid-cols-3">
          <Card>
            <h2 className="mb-3 font-semibold">New item</h2>
            <ModuleForm slug={slug} operation="stock" label="Add item">
              <TextField name="name" label="Name" />
              <TextField name="delta" label="Initial stock" type="number" />
              <TextField name="reason" label="Reason" maxLength={300} />
            </ModuleForm>
          </Card>
          <Card>
            <h2 className="mb-3 font-semibold">Adjust stock</h2>
            <ModuleForm slug={slug} operation="stock" label="Record movement">
              <SelectField name="itemId" label="Item" items={items} />
              <TextField name="delta" label="Change (+ or −)" type="number" />
              <TextField name="reason" label="Reason" maxLength={300} />
            </ModuleForm>
          </Card>
          <Card>
            <h2 className="mb-3 font-semibold">Meal slot</h2>
            <ModuleForm slug={slug} operation="slot" label="Create slot">
              <SelectField name="eventId" label="Event" items={eventItems} />
              <SelectField name="itemId" label="Stock item" items={items} />
              <TextField name="name" label="Meal name" maxLength={100} />
            </ModuleForm>
          </Card>
        </div>
      ) : null}
      <h2 className="my-3 font-semibold">Meal slots</h2>
      <Table head={["Meal", "Event", "Stock item"]}>
        {slots.map((s) => (
          <tr key={s.id}>
            <Td>{s.name}</Td>
            <Td>{events.find((e) => e.id === s.eventId)?.title}</Td>
            <Td>{items.find((i) => i.id === s.itemId)?.name}</Td>
          </tr>
        ))}
      </Table>
      <h2 className="my-3 font-semibold">Recent movements</h2>
      <Table head={["Item", "Change", "Reason", "Time"]}>
        {movements.map((m) => (
          <tr key={m.id}>
            <Td>{items.find((i) => i.id === m.itemId)?.name}</Td>
            <Td>{m.delta}</Td>
            <Td>{m.reason}</Td>
            <Td>{formatDateTime(m.createdAt)}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
