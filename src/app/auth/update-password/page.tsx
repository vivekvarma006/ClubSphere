import Link from "next/link";
import { Suspense } from "react";
import { getVerifiedActor } from "@/server/auth/session";
import { PasswordForm } from "./password-form";

async function RecoveryContent() {
  if (!(await getVerifiedActor())) {
    return (
      <>
        <p className="text-zinc-600 dark:text-zinc-400">Open the password recovery link from your email to choose a new password. If your link has expired, request a new one.</p>
        <Link href="/" className="font-medium underline">Back to the start</Link>
      </>
    );
  }
  return <PasswordForm />;
}

export default function UpdatePasswordPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-6 py-24">
      <h1 className="text-balance text-2xl font-semibold">Choose a new password</h1>
      <Suspense fallback={<p role="status" className="text-zinc-600 dark:text-zinc-400">Checking your recovery session…</p>}>
        <RecoveryContent />
      </Suspense>
    </main>
  );
}
