import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/app/actions";
import { pageContext } from "@/app/page-utils";
import { buttonClass } from "@/components/ui";
import { AppNavigation } from "@/components/app-navigation";
import { BrandMark, Icon } from "@/components/icons";
import { isDemoMode } from "@/server/env";
import { isPlatformAdmin } from "@/server/services/administration";
import { getMyProfile, listClubs } from "@/server/services/clubs";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { actor, db } = await pageContext();
  const me = await getMyProfile(db, actor);
  const admin = await isPlatformAdmin(db, actor);
  const clubs = (await listClubs(db, actor)).filter(club => club.membership === "active" && club.status === "active");

  return (
    <div className="app-shell">
      <a href="#app-content" className="skip-link">Skip to content</a>
      <aside className="app-sidebar">
        <Link href="/dashboard" className="brand-lockup"><BrandMark /><span>ClubSphere<span className="brand-caption">A place to belong.</span></span></Link>
        <div className="sidebar-navigation"><AppNavigation clubs={clubs} admin={admin} /></div>
        <div className="sidebar-bottom">
          <div className="mb-5 rounded-xl border border-emerald-400/15 bg-emerald-400/5 p-4">
            <Icon name="bolt" className="mb-2 text-emerald-400" />
            <p className="text-sm font-medium text-zinc-100">Small actions. Lasting impact.</p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-400">Show up, lend a hand, make it count.</p>
          </div>
          <div className="flex min-w-0 items-center gap-3 border-t border-zinc-800 pt-5">
            <span className="profile-avatar">{me.displayName.slice(0,1)}</span><div className="min-w-0"><p className="truncate text-sm font-medium">{me.displayName}</p><p className="text-xs text-zinc-500">{admin ? "Platform administrator" : "ClubSphere member"}</p></div>
          </div>
          <form action={signOut} className="mt-3"><button type="submit" className={`${buttonClass("ghost", "sm")} w-full justify-start`}>Sign out <span className="ml-auto" aria-hidden="true">↗</span></button></form>
        </div>
      </aside>
      <div className="app-workspace">
        <header className="workspace-header">
          <Link href="/dashboard" className="flex items-center gap-2 font-semibold lg:hidden"><span className="text-emerald-400"><BrandMark /></span>ClubSphere</Link>
          <div className="hidden items-center gap-2 text-xs text-zinc-400 lg:flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Your campus. Your community.</div>
          <div className="ml-auto flex items-center gap-3">
            {isDemoMode() ? <span className="rounded-full border border-emerald-400/20 bg-emerald-400/5 px-2.5 py-1 text-[10px] font-medium tracking-wide text-emerald-300"><span className="sm:hidden">DEMO</span><span className="hidden sm:inline">DEMO WORKSPACE</span></span> : null}
            <form action={signOut} className="lg:hidden"><button type="submit" className={`${buttonClass("ghost", "sm")} whitespace-nowrap`}>Sign out</button></form>
            <span className="profile-avatar h-8 w-8 text-xs" title={me.displayName}>{me.displayName.slice(0,1)}</span>
          </div>
        </header>
        <details className="mobile-navigation lg:hidden"><summary>Workspace menu <span aria-hidden="true">☰</span></summary>
          <div className="p-3"><AppNavigation clubs={clubs} admin={admin} /></div>
        </details>
        <div id="app-content" tabIndex={-1} className="workspace-content">{children}</div>
      </div>
    </div>
  );
}
