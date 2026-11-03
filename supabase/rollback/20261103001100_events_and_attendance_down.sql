-- Rollback for 20261103001100_events_and_attendance.sql (development only).
drop view if exists public.report_event_attendance;
drop function if exists private.event_registration_counts(uuid);
drop function if exists private.check_in_registration(uuid);
drop function if exists private.check_in(uuid, text);
drop function if exists private.record_attendance(public.event_registrations);
drop function if exists private.cancel_registration(uuid);
drop function if exists private.register_for_event(uuid);
drop table if exists public.event_attendance;
drop table if exists public.registration_credentials;
drop table if exists public.event_registrations;
drop function if exists private.issue_registration_credential();
drop table if exists public.events;
delete from public.role_permissions where permission_key in ('event.manage', 'event.checkin');
delete from public.permissions where key in ('event.manage', 'event.checkin');
