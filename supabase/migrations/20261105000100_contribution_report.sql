-- One RLS-protected report from the existing multi-table contribution view.
-- Aggregate each activity BEFORE joining members (in the view) to avoid
-- multiplying attendance by tasks or certificates.
create function private.contribution_report(p_org_id uuid)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare v_report jsonb;
begin
  if not private.module_enabled(p_org_id, 'analytics')
     or not private.has_org_permission(p_org_id, 'analytics.read') then
    raise exception 'report not available' using errcode = 'CS403';
  end if;
  with members as materialized (
    select * from public.report_member_contributions where organization_id = p_org_id
  )
  select jsonb_build_object(
    'generatedAt', now(),
    'summary', jsonb_build_object(
      'members', count(*),
      'contributors', count(*) filter (where score > 0),
      'inactive', count(*) filter (where score = 0),
      'attendance', coalesce(sum(attended), 0),
      'tasks', coalesce(sum(tasks_completed), 0),
      'ctfPoints', coalesce(sum(ctf_points), 0),
      'certificates', coalesce(sum(certificates), 0)
    ),
    'members', coalesce(jsonb_agg(jsonb_build_object(
      'userId', user_id, 'displayName', display_name, 'attended', attended,
      'tasksCompleted', tasks_completed, 'ctfPoints', ctf_points,
      'certificates', certificates, 'score', score, 'rank', rank
    ) order by rank, display_name, user_id), '[]'::jsonb)
  ) into v_report from members;
  return v_report;
end;
$$;
revoke all on function private.contribution_report(uuid) from public, anon;
grant execute on function private.contribution_report(uuid) to authenticated;
