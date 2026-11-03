select private.register_permission('ctf.manage','Create CTF challenges',array['officer']);
create table public.ctf_challenges (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, event_id uuid not null,
  title text not null check(char_length(btrim(title)) between 3 and 120),
  description text not null check(char_length(description) between 1 and 5000),
  points int not null check(points between 1 and 10000),
  flag_hash bytea not null check(octet_length(flag_hash)=32),
  unique(organization_id,id), unique(event_id,id),
  foreign key(organization_id,event_id) references public.events(organization_id,id)
);
create table public.ctf_attempts (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null,
  challenge_id uuid not null, user_id uuid not null references public.profiles(id),
  correct boolean not null, attempted_at timestamptz not null default now(),
  unique(organization_id,id),
  foreign key(organization_id,challenge_id) references public.ctf_challenges(organization_id,id)
);
create table public.ctf_solves (
  organization_id uuid not null, challenge_id uuid not null, user_id uuid not null references public.profiles(id),
  solved_at timestamptz not null default now(), points int not null check(points>0), document_id uuid,
  primary key(challenge_id,user_id),
  foreign key(organization_id,challenge_id) references public.ctf_challenges(organization_id,id),
  foreign key(organization_id,document_id) references public.documents(organization_id,id)
);
create function private.create_challenge(p_org uuid,p_event uuid,p_title text,p_description text,p_points int,p_flag text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.require_module(p_org,'ctf','ctf.manage');
  if p_flag is null or char_length(p_flag) not between 1 and 500 then raise exception 'invalid flag' using errcode='CS422'; end if;
  if not exists(select 1 from public.events where id=p_event and organization_id=p_org and category='ctf') then raise exception 'CTF event not found' using errcode='CS404'; end if;
  insert into public.ctf_challenges(organization_id,event_id,title,description,points,flag_hash)
  values(p_org,p_event,p_title,p_description,p_points,sha256(convert_to(p_flag,'UTF8'))) returning id into v_id;
  return v_id;
end;
$$;
create function private.submit_flag(p_org uuid,p_challenge uuid,p_flag text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_ch public.ctf_challenges; v_ok boolean; v_solve uuid;
begin
  perform private.require_module(p_org,'ctf');
  select c.* into v_ch from public.ctf_challenges c join public.events e on e.id=c.event_id
    where c.id=p_challenge and c.organization_id=p_org and e.status='published' and now() between e.starts_at and e.ends_at;
  if not found then raise exception 'challenge not open' using errcode='CS404'; end if;
  if p_flag is null or char_length(p_flag) not between 1 and 500 then raise exception 'invalid flag' using errcode='CS422'; end if;
  if (select count(*) from public.ctf_attempts where user_id=auth.uid() and attempted_at>now()-interval '1 minute')>=20 then
    raise exception 'too many attempts; try again in a minute' using errcode='CS409'; end if;
  v_ok := v_ch.flag_hash=sha256(convert_to(p_flag,'UTF8'));
  insert into public.ctf_attempts(organization_id,challenge_id,user_id,correct) values(p_org,p_challenge,auth.uid(),v_ok);
  if not v_ok then return 'incorrect'; end if;
  insert into public.ctf_solves(organization_id,challenge_id,user_id,points) values(p_org,p_challenge,auth.uid(),v_ch.points)
    on conflict do nothing returning challenge_id into v_solve;
  return case when v_solve is null then 'already_solved' else 'solved' end;
end;
$$;
alter table public.ctf_challenges enable row level security;
alter table public.ctf_attempts enable row level security;
alter table public.ctf_solves enable row level security;
revoke all on public.ctf_challenges,public.ctf_attempts,public.ctf_solves from public,anon,authenticated;
-- A table-level SELECT would disclose hashes. Never grant it.
grant select(id,organization_id,event_id,title,description,points) on public.ctf_challenges to authenticated;
grant select on public.ctf_attempts,public.ctf_solves to authenticated;
create policy challenges_read on public.ctf_challenges for select to authenticated using(private.module_enabled(organization_id,'ctf') and
  (private.has_org_permission(organization_id,'ctf.manage') or exists(select 1 from public.events e where e.id=event_id and e.status<>'draft')));
create policy attempts_read on public.ctf_attempts for select to authenticated using(private.module_enabled(organization_id,'ctf') and (user_id=auth.uid() or private.has_org_permission(organization_id,'ctf.manage')));
create policy solves_read on public.ctf_solves for select to authenticated using(private.module_enabled(organization_id,'ctf'));
create view public.ctf_scoreboard with(security_invoker=true) as
select s.organization_id,c.event_id,s.user_id,sum(s.points)::bigint as points,
  rank() over(partition by s.organization_id,c.event_id order by sum(s.points) desc) as rank
from public.ctf_solves s join public.ctf_challenges c on c.id=s.challenge_id
group by s.organization_id,c.event_id,s.user_id;
revoke all on public.ctf_scoreboard from public,anon; grant select on public.ctf_scoreboard to authenticated;
create trigger challenges_audit after insert or update or delete on public.ctf_challenges for each row execute function private.audit_row_change('challenge');
create trigger attempts_audit after insert or update or delete on public.ctf_attempts for each row execute function private.audit_row_change('attempt','challenge_id','correct');
create trigger solves_audit after insert or update or delete on public.ctf_solves for each row execute function private.audit_row_change('solve','challenge_id','user_id');
create index challenges_org_idx on public.ctf_challenges(organization_id,event_id);
create index attempts_user_time_idx on public.ctf_attempts(user_id,attempted_at);
create index solves_org_idx on public.ctf_solves(organization_id,user_id);
revoke all on function private.create_challenge(uuid,uuid,text,text,int,text),private.submit_flag(uuid,uuid,text) from public,anon,authenticated;
grant execute on function private.create_challenge(uuid,uuid,text,text,int,text),private.submit_flag(uuid,uuid,text) to authenticated;
