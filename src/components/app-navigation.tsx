"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";
import type { IconName } from "@/components/icons";
import { Icon } from "@/components/icons";

export function AppNavigation({ clubs, admin }: { clubs: { slug: string; name: string; primaryColor: string | null }[]; admin: boolean }) {
  const pathname = usePathname();
  const links: { href: string; label: string; icon: IconName }[] = [
    { href: "/dashboard", label: "Dashboard", icon: "grid" },
    { href: "/join", label: "Discover clubs", icon: "compass" },
    ...(admin ? [{ href: "/admin", label: "Platform admin", icon: "shield" as const }] : []),
  ];
  return <>
    <nav aria-label="Main navigation" className="space-y-1">
      {links.map(link => <Link key={link.href} href={link.href} aria-current={pathname.startsWith(link.href) ? "page" : undefined}
        className={cx("sidebar-link", pathname.startsWith(link.href) && "is-active")}>
        <Icon name={link.icon} /><span>{link.label}</span>{pathname.startsWith(link.href) ? <span className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-400" /> : null}
      </Link>)}
    </nav>
    <div className="mt-9">
      <div className="mb-3 flex items-center justify-between px-3"><p className="eyebrow">Your clubs</p><Link href="/join" aria-label="Find more clubs" className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white">+</Link></div>
      <nav aria-label="Your clubs" className="space-y-1">
        {clubs.map(club => <Link key={club.slug} href={`/o/${club.slug}`} className={cx("sidebar-link", pathname.startsWith(`/o/${club.slug}/`) || pathname === `/o/${club.slug}` ? "is-active" : "")}
          aria-current={pathname === `/o/${club.slug}` ? "page" : undefined}>
          <span className="club-avatar" style={{ borderColor: club.primaryColor ?? "var(--accent)" }}>{club.name.split(" ").map(word => word[0]).slice(0,2).join("")}</span>
          <span className="min-w-0 truncate">{club.name}</span>
        </Link>)}
        {!clubs.length ? <p className="px-3 text-xs leading-relaxed text-zinc-500">Your clubs will appear here once you join.</p> : null}
      </nav>
    </div>
  </>;
}
