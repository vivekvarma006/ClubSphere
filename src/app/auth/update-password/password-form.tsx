"use client";

import Link from "next/link";
import { useActionState } from "react";
import { updatePassword, type PasswordUpdateState } from "./actions";

const inputClass = "min-h-11 w-full rounded-md border border-zinc-300 bg-transparent px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500 dark:border-zinc-700";
const initialState: PasswordUpdateState = { status: "idle", message: "" };

export function PasswordForm() {
  const [state, formAction, pending] = useActionState(updatePassword, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.status !== "success" && (
        <>
          <p id="password-help" className="text-sm text-zinc-600 dark:text-zinc-400">Use 8–128 characters for your new password.</p>
          <fieldset disabled={pending} className="flex flex-col gap-4 disabled:opacity-60">
            <div className="flex flex-col gap-2">
              <label htmlFor="password" className="font-medium">New password</label>
              <input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} aria-describedby="password-help" className={inputClass} />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="confirmation" className="font-medium">Confirm new password</label>
              <input id="confirmation" name="confirmation" type="password" autoComplete="new-password" required minLength={8} maxLength={128} className={inputClass} />
            </div>
            <button type="submit" className="min-h-11 rounded-md bg-zinc-900 px-4 font-medium text-white hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">
              {pending ? "Updating password…" : "Update password"}
            </button>
          </fieldset>
        </>
      )}
      <p aria-live="polite" role="status" className={state.status === "error" ? "text-red-700 dark:text-red-400" : "text-zinc-600 dark:text-zinc-400"}>{state.message}</p>
      {state.status === "success" && <Link href="/" className="font-medium underline">Continue to ClubSphere</Link>}
    </form>
  );
}
