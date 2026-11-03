-- Private, bounded one-row-per-actor/bucket counters. Each reservation is committed
-- in a separate service transaction so failed scans still consume the budget.
create table private.request_limits (
  user_id uuid not null references public.profiles(id) on delete cascade,
  bucket text not null check(bucket in ('scan','membership','flag')),
  started_at timestamptz not null default now(), hits int not null,
  primary key(user_id,bucket)
);
revoke all on private.request_limits from public,anon,authenticated;
create function private.reserve_request(p_bucket text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=private.require_actor(); v_limit int; v_window interval; v_hits int;
begin
  if p_bucket='scan' then v_limit:=120; v_window:=interval '1 minute';
  elsif p_bucket='flag' then v_limit:=20; v_window:=interval '1 minute';
  elsif p_bucket='membership' then v_limit:=6; v_window:=interval '10 minutes';
  else raise exception 'invalid request category' using errcode='CS422'; end if;
  insert into private.request_limits(user_id,bucket,hits) values(v_actor,p_bucket,1)
  on conflict(user_id,bucket) do update set
    hits=case when request_limits.started_at<=now()-v_window then 1 else least(request_limits.hits+1,v_limit+1) end,
    started_at=case when request_limits.started_at<=now()-v_window then now() else request_limits.started_at end
  returning hits into v_hits;
  return v_hits<=v_limit;
end;
$$;
revoke all on function private.reserve_request(text) from public,anon,authenticated;
grant execute on function private.reserve_request(text) to authenticated;
