export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-6 py-24">
      <h1 className="text-4xl font-semibold tracking-tight">ClubSphere</h1>
      <p className="text-lg text-zinc-600 dark:text-zinc-400">
        Membership, events and operations for student clubs and organizations.
      </p>
      <p className="text-sm text-zinc-500">
        Phase 1 foundation: authentication plumbing, organization-scoped roles and audited membership review.
        Sign-in and onboarding screens arrive in Phase 2.
      </p>
    </main>
  );
}
