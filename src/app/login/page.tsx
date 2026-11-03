import Link from "next/link";
import { redirect } from "next/navigation";
import { createDemoAccount, signInAsDemoUser } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Field, Notice, inputClass } from "@/components/ui";
import { getVerifiedActor } from "@/server/auth/session";
import { listDemoPersonas } from "@/server/demo/personas";
import { isDemoMode } from "@/server/env";

export const metadata = { title: "Sign in · ClubSphere" };

export default async function LoginPage() {
  if (await getVerifiedActor().catch(() => null)) redirect("/dashboard");

  if (!isDemoMode()) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-6 py-24">
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <Notice>
          This build is the Review-1 prototype. Supabase sign-in screens (email and password, Google) are the next milestone. To
          explore the prototype, run <code>npm run demo</code>.
        </Notice>
        <Link className="text-sm underline" href="/">
          Back
        </Link>
      </main>
    );
  }

  const personas = await listDemoPersonas();
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-12">
      <div className="mb-8 space-y-2">
        <Badge tone="amber">Demo mode</Badge>
        <h1 className="text-3xl font-semibold tracking-tight">Sign in as a demo user</h1>
        <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          Local database with sample data. Each account has different roles, so you can see how permissions change what a
          person may do. In production this screen is replaced by Supabase Auth (email or Google).
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {personas.map((p) => (
          <form key={p.userId} action={signInAsDemoUser}>
            <input type="hidden" name="userId" value={p.userId} />
            <button
              type="submit"
              className="h-full w-full rounded-xl border border-zinc-200 bg-white p-4 text-left shadow-sm transition hover:border-[var(--accent)] hover:shadow dark:border-zinc-800 dark:bg-zinc-900"
            >
              <span className="block font-medium">{p.displayName}</span>
              <span className="block text-xs text-zinc-500">{p.email}</span>
              <span className="mt-2 flex flex-wrap gap-1">
                {p.isPlatformAdmin ? <Badge tone="violet">Platform admin</Badge> : null}
                {p.roles.length === 0 && !p.isPlatformAdmin ? <Badge>No club yet</Badge> : null}
                {p.roles.map((r) => (
                  <Badge key={r} tone={r.startsWith("Applied") ? "amber" : r.startsWith("Owner") || r.startsWith("Officer") ? "blue" : "neutral"}>
                    {r}
                  </Badge>
                ))}
              </span>
            </button>
          </form>
        ))}
      </div>

      <Card className="mt-8 max-w-md">
        <CardTitle>Or create a new demo account</CardTitle>
        <ActionForm action={createDemoAccount} className="space-y-3">
          <Field label="Name">
            <input name="displayName" required minLength={2} maxLength={60} className={inputClass} />
          </Field>
          <Field label="Email" hint="Treated as already verified in demo mode.">
            <input name="email" type="email" required className={inputClass} />
          </Field>
          <SubmitButton pendingLabel="Creating...">Create and sign in</SubmitButton>
        </ActionForm>
      </Card>
    </main>
  );
}
