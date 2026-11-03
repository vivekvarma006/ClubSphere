import { pageContext } from "@/app/page-utils";
import { Badge, ButtonLink, Card, PageHeader } from "@/components/ui";
import { listClubs } from "@/server/services/clubs";

export const metadata = { title: "Join a club · ClubSphere" };

export default async function JoinPage() {
  const { actor, db } = await pageContext();
  const clubs = await listClubs(db, actor);

  return (
    <div>
      <PageHeader title="Join a club" description="Request membership; an officer of the club reviews every request." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {clubs.map((c) => (
          <Card key={c.slug} className="flex flex-col gap-3">
            <div className="h-1.5 w-12 rounded-full" style={{ background: c.primaryColor ?? "var(--accent)" }} />
            <h2 className="text-lg font-semibold">{c.name}</h2>
            <div className="mt-auto">
              {c.membership === "active" ? (
                <ButtonLink href={`/o/${c.slug}`} variant="secondary" size="sm">
                  Open (you are a member)
                </ButtonLink>
              ) : c.membership === "suspended" ? (
                <Badge tone="red">Membership suspended</Badge>
              ) : c.pendingRequest ? (
                <Badge tone="amber">Request pending</Badge>
              ) : c.onboardingPolicy !== "approval_required" ? (
                <Badge>Not accepting requests</Badge>
              ) : (
                <ButtonLink href={`/join/${c.slug}`} size="sm">
                  Request to join
                </ButtonLink>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
