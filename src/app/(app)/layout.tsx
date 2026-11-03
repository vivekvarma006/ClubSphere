import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/app/actions";
import { pageContext } from "@/app/page-utils";
import { buttonClass } from "@/components/ui";
import { isDemoMode } from "@/server/env";
import { isPlatformAdmin } from "@/server/services/administration";
import { getMyProfile } from "@/server/services/clubs";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { actor, db } = await pageContext();
  const me = await getMyProfile(db, actor);
  const admin = await isPlatformAdmin(db, actor);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      {isDemoMode() ? (
        <div className="bg-amber-100 px-4 py-1 text-center text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Demo mode: local sample data. <Link className="underline" href="/login">Switch user</Link>
        </div>
      ) : null}
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 sm:gap-6 px-6 py-3">
          <Link href="/dashboard" className="font-semibold tracking-tight">
            ClubSphere
          </Link>
          <nav className="flex flex-wrap gap-1 text-sm">
            {admin ? <Link className={buttonClass("ghost", "sm")} href="/admin">Platform admin</Link> : null}
            <Link className={buttonClass("ghost", "sm")} href="/dashboard">
              Dashboard
            </Link>
            <Link className={buttonClass("ghost", "sm")} href="/join">
              Join a club
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-zinc-600 sm:inline dark:text-zinc-400">{me.displayName}</span>
            <form action={signOut}>
              <button type="submit" className={buttonClass("secondary", "sm")}>
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</div>
    </div>
  );
}
