"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

export interface Tab {
  href: string;
  label: string;
}

/** Club navigation; tabs are pre-filtered on the server by the user's permissions. */
export function ClubTabs({ tabs }: { tabs: Tab[] }) {
  const pathname = usePathname();
  const active = (href: string) => (href.split("/").length === 3 ? pathname === href : pathname.startsWith(href));
  return (
    <nav aria-label="Club navigation" className="flex gap-1 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950 p-1">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={active(t.href) ? "page" : undefined}
          className={cx(
            "whitespace-nowrap rounded-lg px-3 py-2.5 text-xs transition-colors",
            active(t.href)
              ? "bg-emerald-400/10 font-medium text-emerald-300"
              : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
