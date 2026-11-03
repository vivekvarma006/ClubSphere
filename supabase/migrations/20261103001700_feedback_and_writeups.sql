create table public.event_feedback (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, event_id uuid not null,
  user_id uuid not null references public.profiles(id), rating int not null check(rating between 1 and 5),
  comment text not null check(char_length(btrim(comment)) between 1 and 5000), document_id uuid not null,
  created_at timestamptz not null default now(), unique(event_id,user_id), unique(organization_id,id),
  foreign key(organization_id,event_id) references public.events(organization_id,id),
  foreign key(organization_id,document_id) references public.documents(organization_id,id)
);
-- Internal indexing primitive: callers enforce their own attendance/solve predicate.
create function private.index_member_document(p_org uuid,p_event uuid,p_title text,p_source text,p_body text,p_model text,p_chunks jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_doc uuid;
begin
  if p_chunks is null or jsonb_typeof(p_chunks)<>'array' or jsonb_array_length(p_chunks) not between 1 and 50 then
    raise exception 'invalid document chunks' using errcode='CS422'; end if;
  insert into public.documents(organization_id,event_id,title,source_type,body,visibility)
    values(p_org,p_event,p_title,p_source,p_body,'members') returning id into v_doc;
  insert into public.document_chunks(organization_id,document_id,chunk_index,content,embedding,embedding_model)
    select p_org,v_doc,(c.ordinality-1)::int,c.value->>'content',(c.value->>'embedding')::extensions.vector,p_model
    from jsonb_array_elements(p_chunks) with ordinality c;
  return v_doc;
end;
$$;
create function private.submit_feedback(p_org uuid,p_event uuid,p_rating int,p_comment text,p_model text,p_chunks jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_doc uuid; v_title text;
begin
  perform private.require_module(p_org,'feedback');
  select e.title into v_title from public.events e join public.event_attendance a on a.event_id=e.id
    join public.event_registrations r on r.id=a.registration_id
    where e.id=p_event and e.organization_id=p_org and e.status='completed' and r.user_id=auth.uid();
  if not found then raise exception 'attended, completed event not found' using errcode='CS404'; end if;
  v_doc:=private.index_member_document(p_org,p_event,'Feedback: '||left(v_title,180),'feedback',p_comment,p_model,p_chunks);
  insert into public.event_feedback(organization_id,event_id,user_id,rating,comment,document_id)
    values(p_org,p_event,auth.uid(),p_rating,p_comment,v_doc) returning id into v_id;
  return v_id;
end;
$$;
create function private.save_writeup(p_org uuid,p_challenge uuid,p_body text,p_model text,p_chunks jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_ch public.ctf_challenges; v_doc uuid;
begin
  perform private.require_module(p_org,'ctf');
  select * into v_ch from public.ctf_challenges where id=p_challenge and organization_id=p_org;
  if not found or not exists(select 1 from public.ctf_solves where challenge_id=p_challenge and user_id=auth.uid() and document_id is null) then
    raise exception 'unpublished solve not found' using errcode='CS404'; end if;
  if not exists(select 1 from public.events where id=v_ch.event_id and (status='completed' or ends_at<=now())) then
    raise exception 'write-ups open after the CTF ends' using errcode='CS409'; end if;
  v_doc:=private.index_member_document(p_org,v_ch.event_id,'Write-up: '||v_ch.title,'writeup',p_body,p_model,p_chunks);
  update public.ctf_solves set document_id=v_doc where challenge_id=p_challenge and user_id=auth.uid();
  return v_doc;
end;
$$;
alter table public.event_feedback enable row level security;
revoke all on public.event_feedback from public,anon,authenticated;
grant select on public.event_feedback to authenticated;
create policy feedback_read on public.event_feedback for select to authenticated using(private.module_enabled(organization_id,'feedback') and (user_id=auth.uid() or private.has_org_permission(organization_id,'analytics.read')));
create trigger feedback_audit after insert or update or delete on public.event_feedback for each row execute function private.audit_row_change('feedback','event_id','rating');
create index feedback_org_idx on public.event_feedback(organization_id,event_id);
revoke all on function private.index_member_document(uuid,uuid,text,text,text,text,jsonb),private.submit_feedback(uuid,uuid,int,text,text,jsonb),private.save_writeup(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function private.submit_feedback(uuid,uuid,int,text,text,jsonb),private.save_writeup(uuid,uuid,text,text,jsonb) to authenticated;
