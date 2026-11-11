import Link from "next/link";
import { BrandMark } from "@/components/icons";
import { redirect } from "next/navigation";
import { createDemoAccount, signInAsDemoUser } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Field, inputClass } from "@/components/ui";
import { getVerifiedActor } from "@/server/auth/session";
import { listDemoPersonas } from "@/server/demo/personas";
import { isDemoMode } from "@/server/env";

export const metadata = { title: "Sign in · ClubSphere" };

import { safeNextPath } from "@/lib/safe-redirect";
import { AuthForms } from "./auth-forms";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const query = await searchParams;
  const next = safeNextPath(
    typeof query.next === "string" ? query.next : null,
    "/dashboard",
  );
  if (await getVerifiedActor().catch(() => null)) redirect("/dashboard");

  if (!isDemoMode()) {
    return (
      <main className="mx-auto grid min-h-screen w-full max-w-6xl items-center gap-12 px-6 py-12 lg:grid-cols-2 lg:gap-24">
        <div className="public-hero rounded-3xl p-6 py-10 lg:p-10">
          <Link href="/" className="brand-lockup mb-16"><BrandMark /><span>ClubSphere</span></Link>
          <p className="eyebrow mb-4">Your campus. Your community.</p>
          <h2 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">Find your people.<br /><span className="text-emerald-400">Make your mark.</span></h2>
          <p className="mt-6 max-w-sm text-sm leading-relaxed text-zinc-400">Great clubs start with people who show up. Discover events, build something together, and see every contribution count.</p>
          <div className="mt-10 flex gap-2" aria-hidden="true">{Array.from({ length: 15 }, (_, i) => <span key={i} className={`h-3 w-3 rounded-sm ${i % 4 === 0 ? "bg-emerald-400" : i % 3 === 0 ? "bg-emerald-700" : "bg-emerald-950"}`} />)}</div>
        </div>
        <div className="mx-auto w-full max-w-md space-y-5">
        <h1 className="text-2xl font-semibold">
          {query.mode === "signup"
            ? "Create your account"
            : query.mode === "forgot"
              ? "Reset your password"
              : "Sign in"}
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Sign in to find your clubs, events, and contributions.
        </p>
        <AuthForms
          mode={
            query.mode === "signup"
              ? "signup"
              : query.mode === "forgot"
                ? "forgot"
                : "login"
          }
          next={next}
        />
        </div>
      </main>
    );
  }

  const personas = await listDemoPersonas();
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-12">
      <Link href="/" className="brand-lockup mb-10"><BrandMark /><span>ClubSphere</span></Link>
      <div className="mb-8 space-y-2">
        <Badge tone="amber">Demo mode</Badge>
        <h1 className="text-3xl font-semibold tracking-tight">
          Sign in as a demo user
        </h1>
        <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          Local database with sample data. Each account has different roles, so
          you can see how permissions change what a person may do. Supabase
          deployments offer email and Google sign-in.
        </p>
      </div>

      <Card className="mb-6">
        <CardTitle>Try the new workflows</CardTitle>
        <ul className="space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
          <li><strong>Ananya Rao:</strong> My Activity shows an assigned task, a certificate and waitlist position #1.</li>
          <li><strong>Vikram Singh:</strong> cancel your registration for Security Lab: Waitlist Demo to promote Ananya.</li>
          <li><strong>Rohan Gupta:</strong> see both clubs, a robotics task and an already-promoted registration with a private QR.</li>
          <li><strong>Sneha Iyer:</strong> open Cyber Security Club → Reports for the visual dashboard.</li>
        </ul>
      </Card>

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
                {p.isPlatformAdmin ? (
                  <Badge tone="violet">Platform admin</Badge>
                ) : null}
                {p.roles.length === 0 && !p.isPlatformAdmin ? (
                  <Badge>No club yet</Badge>
                ) : null}
                {p.roles.map((r) => (
                  <Badge
                    key={r}
                    tone={
                      r.startsWith("Applied")
                        ? "amber"
                        : r.startsWith("Owner") || r.startsWith("Officer")
                          ? "blue"
                          : "neutral"
                    }
                  >
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
            <input
              name="displayName"
              required
              minLength={2}
              maxLength={60}
              className={inputClass}
            />
          </Field>
          <Field label="Email" hint="Treated as already verified in demo mode.">
            <input name="email" type="email" required className={inputClass} />
          </Field>
          <SubmitButton pendingLabel="Creating...">
            Create and sign in
          </SubmitButton>
        </ActionForm>
      </Card>
    </main>
  );
}
