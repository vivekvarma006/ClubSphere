drop function public.verify_certificate(text),private.issue_certificates(uuid,uuid);
drop table public.certificates;
delete from public.role_permissions where permission_key='certificate.issue';
delete from public.role_template_permissions where permission_key='certificate.issue';
delete from public.permissions where key='certificate.issue';
