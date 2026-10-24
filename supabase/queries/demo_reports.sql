-- =============================================================================
-- ClubSphere report queries for demonstration.
--
-- Run all of them with sample data:   npm run demo:reports
-- Or paste any block into the Supabase SQL editor.
--
-- Each block starts with:
--   -- name: <title>
--   -- as:   postgres | owner_a | owner_b
-- "postgres" runs as the database owner (platform-wide analytics, no RLS).
-- owner_a / owner_b run as that club's owner, so RLS limits what they see.
-- =============================================================================

-- name: 1. Average review time per organization (AVG + GROUP BY)
-- as: postgres
select o.name                                                    as organization,
       count(*)                                                  as reviewed_requests,
       round(avg(extract(epoch from r.reviewed_at - r.applied_at)) / 3600, 2) as avg_hours_to_review
  from membership_requests r
  join organizations o on o.id = r.organization_id
 where r.status in ('approved', 'rejected')
 group by o.name
 order by avg_hours_to_review desc;

-- name: 2. Organizations with at least 2 pending requests (HAVING)
-- as: postgres
select o.name as organization, count(*) as pending_requests
  from membership_requests r
  join organizations o on o.id = r.organization_id
 where r.status = 'pending'
 group by o.name
having count(*) >= 2;

-- name: 3. People who belong to more than one organization (JOIN + GROUP BY + HAVING)
-- as: postgres
select p.display_name, count(*) as organizations, string_agg(o.slug, ', ' order by o.slug) as slugs
  from organization_memberships m
  join profiles p      on p.id = m.user_id
  join organizations o on o.id = m.organization_id
 where m.status = 'active'
 group by p.id, p.display_name
having count(*) > 1;

-- name: 4. Requests that waited longer than their organization's average (correlated subquery)
-- as: postgres
select o.slug, p.display_name,
       round(extract(epoch from r.reviewed_at - r.applied_at) / 3600, 1) as hours_waited
  from membership_requests r
  join organizations o on o.id = r.organization_id
  join profiles p      on p.id = r.user_id
 where r.reviewed_at is not null
   and (r.reviewed_at - r.applied_at) > (
         select avg(r2.reviewed_at - r2.applied_at)
           from membership_requests r2
          where r2.organization_id = r.organization_id
            and r2.reviewed_at is not null)
 order by hours_waited desc;

-- name: 5. Organizations ranked by active members (window function RANK)
-- as: postgres
select o.name, count(m.id) as active_members,
       rank() over (order by count(m.id) desc) as rank
  from organizations o
  left join organization_memberships m on m.organization_id = o.id and m.status = 'active'
 group by o.id, o.name;

-- name: 6. Reviewer activity: decisions per reviewer (JOIN + conditional aggregates)
-- as: postgres
select o.slug, p.display_name as reviewer,
       count(*) filter (where r.status = 'approved') as approved,
       count(*) filter (where r.status = 'rejected') as rejected
  from membership_requests r
  join profiles p      on p.id = r.reviewed_by
  join organizations o on o.id = r.organization_id
 group by o.slug, p.display_name
 order by o.slug, count(*) desc;  -- an alias can't be used inside an expression in ORDER BY

-- name: 7. Applications per month with a running total (window SUM)
-- as: postgres
select month, applications,
       sum(applications) over (order by month) as running_total
  from (select date_trunc('month', applied_at)::date as month, count(*) as applications
          from membership_requests
         group by 1) monthly
 order by month;

-- name: 8. Audit trail: most common recorded actions (GROUP BY on the audit log)
-- as: postgres
select action, count(*) as times
  from audit_logs
 group by action
 order by times desc, action
 limit 8;

-- name: 9. Owner of Alpha sees ONLY Alpha's summary (view + RLS)
-- as: owner_a
select slug, active_members, pending_requests, approval_rate_pct
  from report_org_membership_summary;

-- name: 10. The same query as the owner of Beta returns only Beta
-- as: owner_b
select slug, active_members, pending_requests, approval_rate_pct
  from report_org_membership_summary;

-- name: 11. Review turnaround view for Alpha (AVG, MEDIAN via percentile_cont, MAX)
-- as: owner_a
select slug, reviewed_requests, avg_hours_to_review, median_hours_to_review, max_hours_to_review
  from report_review_turnaround;
