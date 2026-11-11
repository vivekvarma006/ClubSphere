import "server-only";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { VerifiedActor } from "@/server/auth/actor";
import type { Database } from "@/server/db/types";
import { queryRows, withUserContext } from "@/server/db/user-context";
import { handleServiceError } from "@/server/errors";

import { readActivityCalendar } from "./activity-calendar";

const club = { slug: z.string(), organizationName: z.string() };
const timestamp = z.coerce.date();

/** Personal activity across active clubs. Explicit owner predicates are required
 * even for officers, whose RLS visibility includes other members' records. */
export async function getMyActivity(db: Database, actor: VerifiedActor) {
  try {
    return await withUserContext(db, actor, async tx => {
      const [stats] = await queryRows(tx, sql`
        select
          (select count(*)::int from public.event_registrations r join public.events e on e.id=r.event_id
            join public.organizations o on o.id=r.organization_id
            where o.status='active' and r.user_id=${actor.userId}::uuid and r.status='registered' and e.status='published' and e.ends_at>=now()
              and private.is_active_member(r.organization_id)) as upcoming,
          (select count(*)::int from public.task_assignments a
            join public.organization_memberships m on m.id=a.membership_id
            where m.user_id=${actor.userId}::uuid and m.status='active' and a.completed_at is null
              and private.module_enabled(a.organization_id,'volunteers')) as "pendingTasks",
          (select count(*)::int from public.certificates c where c.user_id=${actor.userId}::uuid
            and private.module_enabled(c.organization_id,'certificates')) as certificates,
          (select count(*)::int from public.event_attendance a
            join public.event_registrations r on r.id=a.registration_id
            join public.organizations o on o.id=a.organization_id
            where o.status='active' and r.user_id=${actor.userId}::uuid and private.is_active_member(a.organization_id)) as attended`,
        z.object({ upcoming: z.number(), pendingTasks: z.number(), certificates: z.number(), attended: z.number() }));

      const tasks = await queryRows(tx, sql`
        select t.id,t.title,t.due_at as "dueAt",o.slug,o.name as "organizationName"
        from public.task_assignments a
        join public.organization_memberships m on m.id=a.membership_id and m.organization_id=a.organization_id
        join public.volunteer_tasks t on t.id=a.task_id and t.organization_id=a.organization_id
        join public.organizations o on o.id=a.organization_id
        where m.user_id=${actor.userId}::uuid and m.status='active' and a.completed_at is null
          and private.module_enabled(a.organization_id,'volunteers')
        order by t.due_at nulls last,a.assigned_at,t.id limit 8`,
        z.object({ id: z.uuid(), title: z.string(), dueAt: timestamp.nullable(), ...club }));

      const certificates = await queryRows(tx, sql`
        select c.id,c.event_title as title,c.verification_code as code,c.issued_at as "issuedAt",o.slug,o.name as "organizationName"
        from public.certificates c join public.organizations o on o.id=c.organization_id
        where c.user_id=${actor.userId}::uuid and private.module_enabled(c.organization_id,'certificates')
        order by c.issued_at desc,c.id limit 6`,
        z.object({ id: z.uuid(), title: z.string(), code: z.string(), issuedAt: timestamp, ...club }));

      const recent = await queryRows(tx, sql`
        select e.id,e.title,a.checked_in_at as "checkedInAt",o.slug,o.name as "organizationName"
        from public.event_attendance a join public.event_registrations r on r.id=a.registration_id
        join public.events e on e.id=a.event_id and e.organization_id=a.organization_id
        join public.organizations o on o.id=a.organization_id
        where r.user_id=${actor.userId}::uuid and private.is_active_member(a.organization_id) and o.status='active'
        order by a.checked_in_at desc,e.id limit 6`,
        z.object({ id: z.uuid(), title: z.string(), checkedInAt: timestamp, ...club }));

      const waitlists = await queryRows(tx, sql`
        select e.id,e.title,e.starts_at as "startsAt",o.slug,o.name as "organizationName",q.queue_position as position
        from public.event_waitlist w join public.events e on e.id=w.event_id and e.organization_id=w.organization_id
        join public.organizations o on o.id=w.organization_id
        cross join lateral private.my_event_waitlist(e.id) q
        where w.user_id=${actor.userId}::uuid and w.status='waiting' and q.status='waiting'
        order by e.starts_at,e.id limit 8`,
        z.object({ id: z.uuid(), title: z.string(), startsAt: timestamp, position: z.number(), ...club }));
      const calendar = await readActivityCalendar(tx, actor);
      return { stats: stats!, tasks, certificates, recent, waitlists, calendar };
    });
  } catch (error) {
    throw handleServiceError("activity.mine", error);
  }
}
