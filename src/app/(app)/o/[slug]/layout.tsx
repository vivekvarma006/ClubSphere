import Image from "next/image";
import type { CSSProperties } from "react";
import { load, pageContext } from "@/app/page-utils";
import { ButtonLink, Card } from "@/components/ui";
import { getClubContext } from "@/server/services/clubs";
import { ClubTabs, type Tab } from "./tabs";

export default async function ClubLayout({ children, params }: LayoutProps<"/o/[slug]">) {
  const { slug } = await params;
  const { actor, db } = await pageContext();
  const club = await load(getClubContext(db, actor, slug));
  const can = (p: Parameters<typeof club.permissions.has>[0]) => club.permissions.has(p);

  const tabs: Tab[] = [
    { href: `/o/${slug}`, label: "Overview" },
    { href: `/o/${slug}/events`, label: "Events" },
    { href: `/o/${slug}/search`, label: "Knowledge base" },
    ...(can("member.read") ? [{ href: `/o/${slug}/members`, label: "Members" }] : []),
    ...(can("membership.review") ? [{ href: `/o/${slug}/review`, label: "Review requests" }] : []),
    ...(club.features.volunteers ? [{ href: `/o/${slug}/tasks`, label: "Tasks" }] : []),
    ...(club.features.ctf ? [{ href: `/o/${slug}/ctf`, label: "CTF" }] : []),
    ...(club.features.certificates ? [{ href: `/o/${slug}/certificates`, label: "Certificates" }] : []),
    ...(club.features.feedback ? [{ href: `/o/${slug}/feedback`, label: "Feedback" }] : []),
    ...(club.features.inventory && (can("inventory.manage") || can("food.distribute")) ? [{ href: `/o/${slug}/inventory`, label: "Inventory" }] : []),
    ...(club.features.analytics && can("analytics.read") ? [{ href: `/o/${slug}/leaderboard`, label: "Contributions" }] : []),
    ...(can("audit.read") ? [{ href: `/o/${slug}/audit`, label: "Audit log" }] : []),
    ...(can("org.settings.manage") || can("role.manage") ? [{ href: `/o/${slug}/settings`, label: "Settings" }] : []),
    ...(can("event.checkin") || (club.features.inventory && can("food.distribute")) ? [{ href: `/o/${slug}/scan`, label: "Scan QR" }] : []),
    ...(can("analytics.read") ? [{ href: `/o/${slug}/reports`, label: "Reports" }] : []),
  ];

  const style = club.primaryColor ? ({ "--accent": club.primaryColor } as CSSProperties) : undefined;

  return (
    <div style={style} className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="h-8 w-1.5 rounded-full bg-[var(--accent)]" />
        {club.logoUrl ? <Image src={club.logoUrl} alt="" width={32} height={32} unoptimized className="h-8 w-8 rounded object-contain" /> : null}
        <h1 className="text-xl font-semibold tracking-tight">{club.organization.name}</h1>
        {club.shortName ? <span className="text-xs text-zinc-500">{club.shortName}</span> : null}
      </div>
      {club.isMember ? (
        <>
          <ClubTabs tabs={tabs} />
          {children}
        </>
      ) : (
        <Card>
          <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">This club&apos;s pages are for members.</p>
          <ButtonLink href={`/join/${slug}`}>Request to join</ButtonLink>
        </Card>
      )}
    </div>
  );
}
