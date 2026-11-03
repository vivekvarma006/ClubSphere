-- Rollback for 20261103001200_knowledge_base.sql (development only).
-- The vector extension is left installed; other objects may use it.
drop function if exists private.search_documents(uuid, extensions.vector, text, text, int, double precision);
drop function if exists private.delete_document(uuid);
drop function if exists private.save_document(uuid, uuid, text, text, uuid, text, text, text, jsonb);
drop table if exists public.document_chunks;
drop table if exists public.documents;
delete from public.role_permissions where permission_key = 'document.manage';
delete from public.permissions where key = 'document.manage';
