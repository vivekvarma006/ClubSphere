import { ProfileQuestions } from "./profile-questions";
import { load, pageContext } from "@/app/page-utils";
import { administrationAction } from "@/app/admin-actions";
import { Card, PageHeader, Field, inputClass } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { getSettings } from "@/server/services/administration";
import { parseOrganizationSettings } from "@/server/validation/organization-config";

export default async function SettingsPage({
  params,
}: PageProps<"/o/[slug]/settings">) {
  const { slug } = await params,
    { db, actor } = await pageContext();
  const data = await load(getSettings(db, actor, slug)),
    org = data.organization;
  const settings = parseOrganizationSettings(org.settings);
  const questions = data.fields.map((f) => ({
    key: f.fieldKey,
    label: f.label,
    type: f.fieldType,
    required: f.isRequired,
    ...(f.options ? { options: f.options } : {}),
  }));
  return (
    <>
      <PageHeader
        title="Club settings"
        description="Branding, onboarding, optional modules and custom roles."
      />
      {data.canManageSettings ? (
        <Card>
          <ActionForm
            action={administrationAction.bind(null, slug, "settings")}
            className="space-y-4"
          >
            <Field label="Club name">
              <input
                name="name"
                defaultValue={org.name}
                required
                maxLength={120}
                className={inputClass}
              />
            </Field>
            <Field label="Short name">
              <input
                name="shortName"
                defaultValue={String(org.branding.shortName ?? "")}
                maxLength={40}
                className={inputClass}
              />
            </Field>
            <Field label="Primary color">
              <input
                name="color"
                type="color"
                defaultValue={String(org.branding.primaryColor ?? "#0f766e")}
                className="h-11 w-20"
              />
            </Field>
            <Field label="Logo URL">
              <input
                name="logoUrl"
                type="url"
                defaultValue={String(org.branding.logoUrl ?? "")}
                className={inputClass}
              />
            </Field>
            <Field label="Onboarding">
              <select
                name="policy"
                defaultValue={org.onboardingPolicy}
                className={inputClass}
              >
                <option value="approval_required">Review requests</option>
                <option value="closed">Closed</option>
                <option value="invite_only">
                  Invite only (requests disabled)
                </option>
              </select>
            </Field>
            <Field
              label="Allowed email domains"
              hint="Comma or space separated. Leave empty to allow any verified email."
            >
              <input
                name="domains"
                defaultValue={data.domains.map((d) => d.domain).join(", ")}
                className={inputClass}
              />
            </Field>
            <fieldset>
              <legend className="mb-2 font-medium">Optional modules</legend>
              <div className="flex flex-wrap gap-4">
                {Object.entries(settings.features).map(([key, value]) => (
                  <label key={key} className="flex min-h-11 items-center gap-2">
                    <input
                      type="checkbox"
                      name={`feature.${key}`}
                      defaultChecked={value}
                    />
                    {key}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="flex min-h-11 items-center gap-2">
              <input
                name="notify"
                type="checkbox"
                defaultChecked={
                  settings.notifications.notifyReviewersOnNewRequest
                }
              />
              Notify reviewers on new requests
            </label>
            <ProfileQuestions initial={questions} />
            <SubmitButton pendingLabel="Saving…">Save settings</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
      {data.canManageRoles ? (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {[null, ...data.roles.filter((r) => !r.isSystem)].map((role) => (
            <Card key={role?.id ?? "new"}>
              <h2 className="mb-3 font-semibold">
                {role ? `Edit ${role.name}` : "New custom role"}
              </h2>
              <ActionForm
                action={administrationAction.bind(null, slug, "role")}
                className="space-y-3"
              >
                <input type="hidden" name="roleId" value={role?.id ?? ""} />
                <Field label="Role key">
                  <input
                    name="key"
                    defaultValue={role?.roleKey}
                    required
                    readOnly={Boolean(role)}
                    pattern="[a-z][a-z0-9_]{1,39}"
                    className={inputClass}
                  />
                </Field>
                <Field label="Name">
                  <input
                    name="name"
                    defaultValue={role?.name}
                    required
                    maxLength={60}
                    className={inputClass}
                  />
                </Field>
                <fieldset>
                  <legend className="text-sm font-medium">
                    Permissions you hold
                  </legend>
                  {data.permissions.map((p) => (
                    <label
                      key={p}
                      className="flex min-h-10 items-center gap-2 text-sm"
                    >
                      <input
                        name="permissions"
                        type="checkbox"
                        value={p}
                        defaultChecked={data.grants.some(
                          (g) => g.roleId === role?.id && g.permissionKey === p,
                        )}
                      />
                      {p}
                    </label>
                  ))}
                </fieldset>
                <SubmitButton pendingLabel="Saving…">Save role</SubmitButton>
              </ActionForm>
              {role && data.permissions.includes("role.assign") ? (
                <ActionForm
                  action={administrationAction.bind(null, slug, "deleteRole")}
                  className="mt-6 space-y-3 border-t border-zinc-200 pt-4"
                >
                  <input type="hidden" name="roleId" value={role.id} />
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input name="confirm" type="checkbox" required />
                    Remove this role and all its assignments
                  </label>
                  <SubmitButton variant="danger" pendingLabel="Removing…">
                    Delete custom role
                  </SubmitButton>
                </ActionForm>
              ) : null}
            </Card>
          ))}
        </div>
      ) : null}
    </>
  );
}
