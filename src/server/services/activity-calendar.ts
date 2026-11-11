import "server-only";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { VerifiedActor } from "@/server/auth/actor";
import type { DbTransaction } from "@/server/db/types";
import { queryRows } from "@/server/db/user-context";

/** Called inside the caller's RLS transaction. The org-wide variant is only
 * used after reports has checked analytics.read for that organization. */
export async function readActivityCalendar(tx: DbTransaction, actor: VerifiedActor, organizationId?: string) {
  const org = organizationId ? sql`and a.organization_id=${organizationId}::uuid` : sql``;
  const user = organizationId ? sql`` : sql`and r.user_id=${actor.userId}::uuid`;
  const taskUser = organizationId ? sql`` : sql`and m.user_id=${actor.userId}::uuid`;
  const solveUser = organizationId ? sql`` : sql`and a.user_id=${actor.userId}::uuid`;
  return queryRows(tx, sql`
    with bounds as (
      select (now() at time zone 'UTC')::date as today,
        (((now() at time zone 'UTC')::date-364)::timestamp at time zone 'UTC') as starts,
        (((now() at time zone 'UTC')::date+1)::timestamp at time zone 'UTC') as ends
    ), activity as (
      select a.checked_in_at as at, 'attendance' as kind
      from public.event_attendance a
      join public.event_registrations r on r.id=a.registration_id and r.organization_id=a.organization_id
      join public.organizations o on o.id=a.organization_id and o.status='active'
      cross join bounds b
      where a.checked_in_at>=b.starts and a.checked_in_at<b.ends
        and private.is_active_member(a.organization_id) ${org} ${user}
      union all
      select a.completed_at, 'task'
      from public.task_assignments a
      join public.organization_memberships m on m.id=a.membership_id and m.organization_id=a.organization_id and m.status='active'
      cross join bounds b
      where a.completed_at>=b.starts and a.completed_at<b.ends
        and private.module_enabled(a.organization_id,'volunteers') ${org} ${taskUser}
      union all
      select a.solved_at, 'solve' from public.ctf_solves a cross join bounds b
      where a.solved_at>=b.starts and a.solved_at<b.ends
        and private.module_enabled(a.organization_id,'ctf') ${org} ${solveUser}
    ), daily as (
      select (at at time zone 'UTC')::date as day,
        count(*) filter(where kind='attendance')::int as attendance,
        count(*) filter(where kind='task')::int as tasks,
        count(*) filter(where kind='solve')::int as solves
      from activity group by 1
    )
    select to_char(d.day,'YYYY-MM-DD') as date,
      coalesce(a.attendance,0)::int as attendance,coalesce(a.tasks,0)::int as tasks,coalesce(a.solves,0)::int as solves
    from bounds b cross join lateral generate_series(b.today-364,b.today,interval '1 day') d(day)
    left join daily a on a.day=d.day::date order by d.day`,
    z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), attendance: z.number().int(), tasks: z.number().int(), solves: z.number().int() }));
}
