-- All aggregates run under caller RLS. Analytics readers see a club-wide leaderboard;
-- other members can see their own underlying records only.
-- Extend existing attendance/registration policies for analytics readers, scoped to the club.
create policy registrations_analytics on public.event_registrations for select to authenticated using(private.has_org_permission(organization_id,'analytics.read'));
create policy attendance_analytics on public.event_attendance for select to authenticated using(private.has_org_permission(organization_id,'analytics.read'));
create policy assignments_analytics on public.task_assignments for select to authenticated using(private.module_enabled(organization_id,'volunteers') and private.has_org_permission(organization_id,'analytics.read'));
create policy certificates_analytics on public.certificates for select to authenticated using(private.module_enabled(organization_id,'certificates') and private.has_org_permission(organization_id,'analytics.read'));
create view public.report_member_contributions with(security_invoker=true) as
with attendance as (
 select r.organization_id,r.user_id,count(*)::bigint as attended from public.event_attendance a
 join public.event_registrations r on r.id=a.registration_id group by r.organization_id,r.user_id
), tasks as (
 select a.organization_id,m.user_id,count(*)::bigint as completed from public.task_assignments a
 join public.organization_memberships m on m.id=a.membership_id where a.completed_at is not null group by a.organization_id,m.user_id
), ctf as (
 select organization_id,user_id,sum(points)::bigint as points from public.ctf_solves group by organization_id,user_id
), certs as (
 select organization_id,user_id,count(*)::bigint as issued from public.certificates group by organization_id,user_id
), scores as (
 select m.organization_id,m.user_id,p.display_name,coalesce(a.attended,0) as attended,coalesce(t.completed,0) as tasks_completed,
 coalesce(c.points,0) as ctf_points,coalesce(k.issued,0) as certificates,
 (10*coalesce(a.attended,0)+20*coalesce(t.completed,0)+coalesce(c.points,0)+5*coalesce(k.issued,0))::bigint as score
 from public.organization_memberships m join public.profiles p on p.id=m.user_id
 left join attendance a on a.organization_id=m.organization_id and a.user_id=m.user_id
 left join tasks t on t.organization_id=m.organization_id and t.user_id=m.user_id
 left join ctf c on c.organization_id=m.organization_id and c.user_id=m.user_id
 left join certs k on k.organization_id=m.organization_id and k.user_id=m.user_id
 where m.status='active' and private.module_enabled(m.organization_id,'analytics') and private.has_org_permission(m.organization_id,'analytics.read')
)
select *,rank() over(partition by organization_id order by score desc) as rank from scores;
revoke all on public.report_member_contributions from public,anon;
grant select on public.report_member_contributions to authenticated;
