import type { ReactNode } from "react";
import { moduleAction } from "@/app/module-actions";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, inputClass } from "@/components/ui";

export function ModuleForm({
  slug,
  operation,
  label,
  children,
}: {
  slug: string;
  operation: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <ActionForm
      action={moduleAction.bind(null, slug, operation)}
      className="space-y-3"
    >
      {children}
      <SubmitButton pendingLabel="Saving…">{label}</SubmitButton>
    </ActionForm>
  );
}
export function TextField({
  name,
  label,
  type = "text",
  required = true,
  maxLength = 120,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  maxLength?: number;
}) {
  return (
    <Field label={label}>
      <input
        name={name}
        type={type}
        required={required}
        maxLength={maxLength}
        className={inputClass}
      />
    </Field>
  );
}
export function SelectField({
  name,
  label,
  items,
  optional = false,
}: {
  name: string;
  label: string;
  items: { id: string; name: string }[];
  optional?: boolean;
}) {
  return (
    <Field label={label}>
      <select name={name} required={!optional} className={inputClass}>
        {optional ? <option value="">None</option> : null}
        {items.map((i) => (
          <option key={i.id} value={i.id}>
            {i.name}
          </option>
        ))}
      </select>
    </Field>
  );
}
export function BodyField({
  name = "description",
  label = "Description",
  required = false,
}: {
  name?: string;
  label?: string;
  required?: boolean;
}) {
  return (
    <Field label={label}>
      <textarea
        name={name}
        required={required}
        maxLength={5000}
        rows={4}
        className={inputClass}
      />
    </Field>
  );
}
