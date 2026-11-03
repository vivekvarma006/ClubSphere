-- =============================================================================
-- 1200 Knowledge base with semantic search (pgvector)
--
-- Unstructured text (event notes, guides, CTF write-ups, feedback, minutes)
-- is stored as documents, split into chunks, and each chunk gets a
-- 256-dimensional embedding computed by the application
-- (src/server/search/embeddings.ts). Search combines:
--   * vector similarity  (cosine distance, HNSW index)  -> meaning
--   * full-text search   (tsvector, GIN index)          -> exact words
-- fused with Reciprocal Rank Fusion. Vectors live next to the relational
-- rows, so the same RLS isolation applies to search.
-- =============================================================================

create schema if not exists extensions;
create extension if not exists vector with schema extensions;
grant usage on schema extensions to authenticated;

select private.register_permission('document.manage', 'Publish and remove knowledge-base documents', array['officer']);

create table public.documents (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title           text not null,
  source_type     text not null,
  event_id        uuid,
  body            text not null,
  visibility      text not null default 'members',
  created_by      uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint documents_org_id_key       unique (organization_id, id),
  constraint documents_title_length     check (char_length(btrim(title)) between 3 and 200),
  constraint documents_source_type      check (source_type in ('event_doc', 'guide', 'writeup', 'feedback', 'minutes')),
  constraint documents_body_length      check (char_length(body) between 1 and 50000),
  constraint documents_visibility_valid check (visibility in ('members', 'officers')),
  -- PostgreSQL 15+: SET NULL on only event_id, keeping organization_id.
  constraint documents_event_fk
    foreign key (organization_id, event_id) references public.events (organization_id, id)
    on delete set null (event_id)
);

create index documents_org_created_idx on public.documents (organization_id, created_at desc);

create trigger documents_set_updated_at
  before update on public.documents
  for each row execute function private.set_updated_at();

create trigger documents_audit
  after insert or update or delete on public.documents
  for each row execute function private.audit_row_change('document', 'source_type');

create table public.document_chunks (
  id              bigint generated always as identity primary key,
  organization_id uuid not null,
  document_id     uuid not null,
  chunk_index     int not null,
  content         text not null,
  embedding       extensions.vector(256) not null,
  embedding_model text not null,
  fts             tsvector generated always as (to_tsvector('english', content)) stored,

  constraint document_chunks_position_key  unique (document_id, chunk_index),
  constraint document_chunks_index_valid   check (chunk_index >= 0),
  constraint document_chunks_content_len   check (char_length(content) between 1 and 4000),
  constraint document_chunks_model_len     check (char_length(embedding_model) between 1 and 100),
  constraint document_chunks_document_fk
    foreign key (organization_id, document_id) references public.documents (organization_id, id) on delete cascade
);

-- Approximate nearest neighbour search on cosine distance.
create index document_chunks_embedding_hnsw_idx
  on public.document_chunks using hnsw (embedding extensions.vector_cosine_ops);
-- Full-text search.
create index document_chunks_fts_idx on public.document_chunks using gin (fts);
create index document_chunks_org_model_idx on public.document_chunks (organization_id, embedding_model);

-- -----------------------------------------------------------------------------
-- Writes: document + chunks in one transaction.
-- p_chunks is a JSON array of {"content": text, "embedding": [256 numbers]}.
-- -----------------------------------------------------------------------------
create or replace function private.save_document(
  p_org_id      uuid,
  p_document_id uuid,
  p_title       text,
  p_source_type text,
  p_event_id    uuid,
  p_body        text,
  p_visibility  text,
  p_model       text,
  p_chunks      jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_document_id;
begin
  perform private.require_actor();
  if not private.has_org_permission(p_org_id, 'document.manage') then
    raise exception 'organization not found' using errcode = 'CS404';
  end if;
  if jsonb_typeof(p_chunks) <> 'array' or jsonb_array_length(p_chunks) = 0 then
    raise exception 'a document needs at least one chunk' using errcode = 'CS422';
  end if;

  if v_id is null then
    insert into public.documents (organization_id, title, source_type, event_id, body, visibility)
    values (p_org_id, p_title, p_source_type, p_event_id, p_body, p_visibility)
    returning id into v_id;
  else
    update public.documents
       set title = p_title, source_type = p_source_type, event_id = p_event_id,
           body = p_body, visibility = p_visibility
     where id = v_id and organization_id = p_org_id;
    if not found then
      raise exception 'document not found' using errcode = 'CS404';
    end if;
    delete from public.document_chunks where document_id = v_id;
  end if;

  insert into public.document_chunks (organization_id, document_id, chunk_index, content, embedding, embedding_model)
  select p_org_id, v_id, (c.ordinality - 1)::int, c.value ->> 'content',
         (c.value ->> 'embedding')::extensions.vector, p_model
    from jsonb_array_elements(p_chunks) with ordinality as c;

  return v_id;
end;
$$;

create or replace function private.delete_document(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  perform private.require_actor();
  select organization_id into v_org from public.documents where id = p_document_id;
  if v_org is null or not private.has_org_permission(v_org, 'document.manage') then
    raise exception 'document not found' using errcode = 'CS404';
  end if;
  delete from public.documents where id = p_document_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Hybrid search. SECURITY INVOKER: runs with the caller's rights, so RLS
-- decides which chunks are searchable. Returns the best chunk per document.
-- -----------------------------------------------------------------------------
create or replace function private.search_documents(
  p_org_id          uuid,
  p_query_embedding extensions.vector,
  p_query_text      text,
  p_model           text,
  p_limit           int default 10,
  p_min_similarity  double precision default 0.3
)
returns table (
  document_id         uuid,
  title               text,
  source_type         text,
  event_id            uuid,
  snippet             text,
  semantic_similarity double precision,
  keyword_rank        double precision,
  score               double precision
)
language sql
stable
set search_path = ''
as $$
  with semantic as (
    select c.id, c.document_id, c.content,
           1 - (c.embedding operator(extensions.<=>) p_query_embedding) as similarity,
           row_number() over (order by c.embedding operator(extensions.<=>) p_query_embedding) as rnk
      from public.document_chunks c
     where c.organization_id = p_org_id
       and c.embedding_model = p_model
     order by c.embedding operator(extensions.<=>) p_query_embedding
     limit 40
  ),
  keyword as (
    select c.id, c.document_id, c.content,
           ts_rank_cd(c.fts, q)::double precision as kw_rank,
           row_number() over (order by ts_rank_cd(c.fts, q) desc) as rnk
      from public.document_chunks c,
           websearch_to_tsquery('english', coalesce(p_query_text, '')) as q
     where c.organization_id = p_org_id
       and c.fts @@ q
     order by ts_rank_cd(c.fts, q) desc
     limit 40
  ),
  fused as (
    -- Reciprocal Rank Fusion: score = sum of 1 / (60 + rank) over both lists.
    select coalesce(s.id, k.id)                   as chunk_id,
           coalesce(s.document_id, k.document_id) as document_id,
           coalesce(s.content, k.content)         as content,
           s.similarity,
           k.kw_rank,
           coalesce(1.0 / (60 + s.rnk), 0) + coalesce(1.0 / (60 + k.rnk), 0) as rrf
      from semantic s
      full outer join keyword k on k.id = s.id
     where k.id is not null or s.similarity >= p_min_similarity
  ),
  best_per_document as (
    select distinct on (f.document_id) f.*
      from fused f
     order by f.document_id, f.rrf desc
  )
  select d.id, d.title, d.source_type, d.event_id,
         left(b.content, 320), b.similarity, b.kw_rank, b.rrf::double precision
    from best_per_document b
    join public.documents d on d.id = b.document_id
   order by b.rrf desc
   limit greatest(1, least(p_limit, 50));
$$;

-- -----------------------------------------------------------------------------
-- Privileges and RLS
-- -----------------------------------------------------------------------------
revoke all on public.documents, public.document_chunks from anon, authenticated;
alter table public.documents       enable row level security;
alter table public.document_chunks enable row level security;
grant select on public.documents, public.document_chunks to authenticated;

create policy documents_select on public.documents
  for select to authenticated
  using (private.is_active_member(organization_id)
         and (visibility = 'members' or private.has_org_permission(organization_id, 'document.manage')));

create policy document_chunks_select on public.document_chunks
  for select to authenticated
  using (exists (select 1 from public.documents d where d.id = document_id));

revoke all on all functions in schema private from public, anon;
grant execute on function
  private.save_document(uuid, uuid, text, text, uuid, text, text, text, jsonb),
  private.delete_document(uuid),
  private.search_documents(uuid, extensions.vector, text, text, int, double precision)
to authenticated;
