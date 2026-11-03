import "server-only";
import { z } from "zod";
import { isDemoMode } from "@/server/env";
import { AppError } from "@/server/errors";
import { getDemoPostgres } from "./database";

/** Demo-only helpers behind the "sign in as" screen. They refuse to run outside demo mode. */

export interface DemoPersona {
  userId: string;
  displayName: string;
  email: string;
  roles: string[]; // e.g. "Officer · Cyber Security Club"
  isPlatformAdmin: boolean;
}

function assertDemo(): void {
  if (!isDemoMode()) throw new AppError("FORBIDDEN", "Demo accounts are only available in demo mode.");
}

export async function listDemoPersonas(): Promise<DemoPersona[]> {
  assertDemo();
  const pg = await getDemoPostgres();
  const { rows } = await pg.query<{
    user_id: string;
    display_name: string;
    email: string;
    roles: string[] | null;
    pending: string[] | null;
    is_admin: boolean;
  }>(`
    select p.id as user_id, p.display_name, u.email,
           -- One label per active membership: its most senior role, e.g. "Officer · Robotics Society".
           (select array_agg(x.label order by x.org_name)
              from (select o.name as org_name,
                           (select ro.name
                              from public.membership_roles mr
                              join public.organization_roles ro on ro.id = mr.role_id
                             where mr.membership_id = m.id
                             order by case ro.role_key when 'owner' then 0 when 'officer' then 1
                                                       when 'volunteer' then 2 when 'member' then 4 else 3 end
                             limit 1) || ' · ' || o.name as label
                      from public.organization_memberships m
                      join public.organizations o on o.id = m.organization_id
                     where m.user_id = p.id and m.status = 'active') x) as roles,
           (select array_agg('Applied · ' || o.name) from public.membership_requests q
              join public.organizations o on o.id = q.organization_id
             where q.user_id = p.id and q.status = 'pending') as pending,
           exists (select 1 from public.platform_admins a where a.user_id = p.id) as is_admin
      from public.profiles p
      join auth.users u on u.id = p.id
     order by is_admin desc, p.created_at`);
  return rows.map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    email: r.email,
    roles: [...(r.roles ?? []), ...(r.pending ?? [])],
    isPlatformAdmin: r.is_admin,
  }));
}

const NewDemoUser = z.object({
  displayName: z.string().trim().min(2).max(60),
  email: z.email().max(120).transform((e) => e.toLowerCase()),
});

/** Creates a verified demo account (stands in for sign-up + email confirmation). */
export async function createDemoUser(input: z.input<typeof NewDemoUser>): Promise<string> {
  assertDemo();
  const { displayName, email } = NewDemoUser.parse(input);
  const pg = await getDemoPostgres();
  try {
    const { rows } = await pg.query<{ id: string }>(
      `insert into auth.users (email, email_confirmed_at, raw_user_meta_data)
       values ($1, now(), jsonb_build_object('full_name', $2::text)) returning id`,
      [email, displayName],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error("demo user insert returned no row");
    return id;
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new AppError("CONFLICT", "That email is already used by a demo account.");
    throw error;
  }
}
