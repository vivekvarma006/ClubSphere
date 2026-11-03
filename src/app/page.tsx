import { ButtonLink } from "@/components/ui";
import { getVerifiedActor } from "@/server/auth/session";

const FEATURES = [
  ["Any club, one platform", "Each club has its own roles, questions and branding. The database keeps every club's data separate."],
  ["Reviewed membership", "Signing in grants nothing. Officers approve requests; every decision is audited."],
  ["QR event check-in", "Members get a private QR code per event. Scanning checks them in exactly once."],
  ["Semantic search", "Find write-ups and event notes by meaning, not just matching words (pgvector)."],
] as const;

export default async function Home() {
  const actor = await getVerifiedActor().catch(() => null);
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center gap-10 px-6 py-20">
      <div className="space-y-4">
        <p className="text-sm font-medium text-[var(--accent)]">College club operations</p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">ClubSphere</h1>
        <p className="max-w-2xl text-lg text-zinc-600 dark:text-zinc-400">
          Membership, events, QR attendance and a searchable knowledge base for student clubs, built on PostgreSQL with
          row-level security and pgvector.
        </p>
        <div className="flex gap-3">
          {actor ? <ButtonLink href="/dashboard">Open dashboard</ButtonLink> : <ButtonLink href="/login">Sign in</ButtonLink>}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {FEATURES.map(([title, body]) => (
          <div key={title} className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{body}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
