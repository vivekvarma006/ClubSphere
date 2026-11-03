import { load, pageContext } from "@/app/page-utils";
import { PageHeader, Table, Td } from "@/components/ui";
import { getContributions } from "@/server/services/operations";
export default async function LeaderboardPage({
  params,
}: PageProps<"/o/[slug]/leaderboard">) {
  const { slug } = await params,
    { db, actor } = await pageContext();
  const rows = await load(getContributions(db, actor, slug));
  return (
    <>
      <PageHeader
        title="Contribution leaderboard"
        description="10 points per attendance, 20 per completed task, CTF points, and 5 per certificate. Equal scores share a rank."
      />
      <Table
        head={[
          "Rank",
          "Member",
          "Attendance",
          "Tasks",
          "CTF",
          "Certificates",
          "Score",
        ]}
      >
        {rows.map((r) => (
          <tr key={r.userId}>
            <Td>{r.rank}</Td>
            <Td>{r.displayName}</Td>
            <Td>{r.attended}</Td>
            <Td>{r.tasksCompleted}</Td>
            <Td>{r.ctfPoints}</Td>
            <Td>{r.certificates}</Td>
            <Td>{r.score}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
