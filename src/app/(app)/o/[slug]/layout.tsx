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
    ...(can("membership.review") ? [{ href: `/o/${slug}/review`, label: "Review requests" }] : []),
    ...(can("event.checkin") ? [{ href: `/o/${slug}/scan`, label: "Scan QR" }] : []),
    ...(can("analytics.read") ? [{ href: `/o/${slug}/reports`, label: "Reports" }] : []),
  ];

  const style = club.primaryColor ? ({ "--accent": club.primaryColor } as CSSProperties) : undefined;

  return (
    <div style={style} className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="h-8 w-1.5 rounded-full bg-[var(--accent)]" />
        <h1 className="text-xl font-semibold tracking-tight">{club.organization.name}</h1>
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
