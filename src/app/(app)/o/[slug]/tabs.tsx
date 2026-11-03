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
    <nav className="flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={cx(
            "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm",
            active(t.href)
              ? "border-[var(--accent)] font-medium text-zinc-900 dark:text-zinc-100"
              : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
