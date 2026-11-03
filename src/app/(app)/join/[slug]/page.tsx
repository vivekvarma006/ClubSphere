import { requestToJoin } from "@/app/actions";
import { load, pageContext } from "@/app/page-utils";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, Field, Notice, PageHeader, inputClass } from "@/components/ui";
import { getJoinForm } from "@/server/services/clubs";

export default async function JoinClubPage({ params }: PageProps<"/join/[slug]">) {
  const { slug } = await params;
  const { actor, db } = await pageContext();
  const form = await load(getJoinForm(db, actor, slug));

  return (
    <div className="max-w-xl">
      <PageHeader title={`Join ${form.organization.name}`} description="Answer the club's questions. An officer reviews your request." />
      {form.emailDomains.length > 0 ? (
        <div className="mb-4">
          <Notice>Only verified email addresses from {form.emailDomains.join(", ")} can apply.</Notice>
        </div>
      ) : null}
      <Card>
        <ActionForm action={requestToJoin.bind(null, slug)} className="space-y-4">
          {form.fields.length === 0 ? <p className="text-sm text-zinc-500">This club asks no extra questions.</p> : null}
          {form.fields.map((f) => (
            <Field key={f.key} label={`${f.label}${f.required ? " *" : ""}`}>
              <input type="hidden" name={`type.${f.key}`} value={f.type} />
              {f.type === "select" ? (
                <select name={`answer.${f.key}`} required={f.required} className={inputClass} defaultValue="">
                  <option value="" disabled>
                    Choose...
                  </option>
                  {(f.options ?? []).map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              ) : f.type === "long_text" ? (
                <textarea name={`answer.${f.key}`} required={f.required} maxLength={2000} rows={4} className={inputClass} />
              ) : (
                <input
                  name={`answer.${f.key}`}
                  required={f.required}
                  type={f.type === "number" ? "number" : f.type === "url" ? "url" : "text"}
                  maxLength={f.type === "url" ? 500 : 200}
                  className={inputClass}
                />
              )}
            </Field>
          ))}
          <SubmitButton pendingLabel="Sending...">Send request</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
