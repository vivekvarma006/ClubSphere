drop function private.create_task(uuid,uuid,text,text,timestamptz),private.assign_task(uuid,uuid,uuid),private.complete_task(uuid,uuid);
drop table public.task_assignments,public.volunteer_tasks;
delete from public.role_permissions where permission_key='task.manage';
delete from public.role_template_permissions where permission_key='task.manage';
delete from public.permissions where key='task.manage';
