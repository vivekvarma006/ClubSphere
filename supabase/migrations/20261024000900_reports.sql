-- =============================================================================
-- 0900 Reporting views
--
-- security_invoker = true makes each view run with the CALLER's privileges,
-- so the RLS policies on the underlying tables still apply. Without it a
-- view runs as its owner and would bypass RLS, leaking every organization's
-- numbers to every signed-in user.
--
-- Each view returns rows only for organizations where the caller holds
-- analytics.read. Within those, totals cover the rows RLS lets the caller
-- see; the default owner and officer roles hold member.read and
-- membership.review, so their figures cover the whole organization.
-- =============================================================================

-- One row per organization: membership and request counts.
-- Each side is aggregated in its own CTE before joining. Joining the raw
-- membership and request tables to organizations first would multiply rows
-- (memberships x requests) and inflate every count.
create view public.report_org_membership_summary
with (security_invoker = true) as
with m as (
  select organization_id,
         count(*) filter (where status = 'active')    as active_members,
         count(*) filter (where status = 'suspended') as suspended_members
    from public.organization_memberships
   group by organization_id
),
r as (
  select organization_id,
         count(*) filter (where status = 'pending')  as pending_requests,
         count(*) filter (where status = 'approved') as approved_requests,
         count(*) filter (where status = 'rejected') as rejected_requests
    from public.membership_requests
   group by organization_id
)
select o.id   as organization_id,
       o.slug,
       o.name,
       coalesce(m.active_members, 0)    as active_members,
       coalesce(m.suspended_members, 0) as suspended_members,
       coalesce(r.pending_requests, 0)  as pending_requests,
       coalesce(r.approved_requests, 0) as approved_requests,
       coalesce(r.rejected_requests, 0) as rejected_requests,
       round(100.0 * r.approved_requests
             / nullif(r.approved_requests + r.rejected_requests, 0), 1) as approval_rate_pct
  from public.organizations o
  left join m on m.organization_id = o.id
  left join r on r.organization_id = o.id
 where private.has_org_permission(o.id, 'analytics.read');

-- Review turnaround per organization: "how long do applicants wait?"
create view public.report_review_turnaround
with (security_invoker = true) as
select r.organization_id,
       o.slug,
       count(*) as reviewed_requests,
       round((avg(extract(epoch from (r.reviewed_at - r.applied_at))) / 3600)::numeric, 2) as avg_hours_to_review,
       round((percentile_cont(0.5) within group (
               order by extract(epoch from (r.reviewed_at - r.applied_at))) / 3600)::numeric, 2) as median_hours_to_review,
       round((max(extract(epoch from (r.reviewed_at - r.applied_at))) / 3600)::numeric, 2) as max_hours_to_review
  from public.membership_requests r
  join public.organizations o on o.id = r.organization_id
 where r.status in ('approved', 'rejected')
   and private.has_org_permission(r.organization_id, 'analytics.read')
 group by r.organization_id, o.slug;

-- Active members per role, including roles nobody holds yet.
create view public.report_role_distribution
with (security_invoker = true) as
select ro.organization_id,
       ro.role_key,
       ro.name as role_name,
       count(m.id) as active_members
  from public.organization_roles ro
  left join public.membership_roles mr      on mr.role_id = ro.id
  left join public.organization_memberships m
         on m.id = mr.membership_id and m.status = 'active'
 where private.has_org_permission(ro.organization_id, 'analytics.read')
 group by ro.organization_id, ro.id, ro.role_key, ro.name;

-- Applications per organization per calendar month.
create view public.report_monthly_applications
with (security_invoker = true) as
select organization_id,
       date_trunc('month', applied_at)::date        as month,
       count(*)                                      as applications,
       count(*) filter (where status = 'approved')   as approved,
       count(*) filter (where status = 'rejected')   as rejected,
       count(*) filter (where status = 'pending')    as still_pending
  from public.membership_requests
 where private.has_org_permission(organization_id, 'analytics.read')
 group by organization_id, date_trunc('month', applied_at);

revoke all on public.report_org_membership_summary from anon, authenticated;
revoke all on public.report_review_turnaround      from anon, authenticated;
revoke all on public.report_role_distribution      from anon, authenticated;
revoke all on public.report_monthly_applications   from anon, authenticated;

grant select on public.report_org_membership_summary to authenticated;
grant select on public.report_review_turnaround      to authenticated;
grant select on public.report_role_distribution      to authenticated;
grant select on public.report_monthly_applications   to authenticated;
