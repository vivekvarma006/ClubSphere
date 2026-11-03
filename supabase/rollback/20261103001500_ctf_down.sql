drop view public.ctf_scoreboard;
drop function private.create_challenge(uuid,uuid,text,text,int,text),private.submit_flag(uuid,uuid,text);
drop table public.ctf_solves,public.ctf_attempts,public.ctf_challenges;
delete from public.role_permissions where permission_key='ctf.manage';
delete from public.role_template_permissions where permission_key='ctf.manage';
delete from public.permissions where key='ctf.manage';
