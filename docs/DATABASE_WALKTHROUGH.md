# Database and reporting walkthrough

## PostgreSQL + Redis: why two databases?

PostgreSQL is the RDBMS and source of truth for memberships, events, attendance,
tasks, CTF solves, certificates and inventory. Foreign keys, uniqueness, row-level
security (RLS) and transactions enforce relationships and business rules.

Redis is a separate **NoSQL key-value database** for disposable contribution-report
snapshots. Repeated reads reuse one JSON result for 30 seconds rather than rerun
the joins and aggregates. Keys include organization, user, effective permissions
and club settings. The server checks current SQL permissions and the analytics
switch before every lookup. Redis never grants access or owns business records.
There is no cross-database write transaction to coordinate: snapshots can expire
or disappear without losing source data. Redis errors fall back to SQL.

Tradeoff: reports can lag by 30 seconds, and Redis adds a service to operate.
For a tiny club PostgreSQL alone is sufficient; this use case becomes useful for
frequently viewed reports. The cache is optional to preserve the offline demo.
Both databases are in use only when `REDIS_URL` is configured and reachable.

The client follows Redis's [connection](https://redis.io/docs/latest/develop/clients/nodejs/connect/)
and [error-handling](https://redis.io/docs/latest/develop/clients/nodejs/error-handling/) guidance.

## Triggers already used by real application workflows

| Trigger | When it runs | Why it helps |
|---|---|---|
| `event_registrations_issue_credential` | After inserting an event registration | Calls `private.issue_registration_credential()` to create a private random QR token in the same transaction. Every registration gets a credential regardless of which application path creates it. Failure rolls back the registration. |
| `events_audit` (also attendance/membership audit triggers) | After insert/update/delete | Calls `private.audit_row_change(...)` to record actor and change metadata. This gives administrators an audit trail without relying on every caller remembering to log changes. |
| `events_set_updated_at` | Before an event update | Calls `private.set_updated_at()` so update timestamps stay consistent across writers. |

These are already installed by the existing migrations and exercised by the
registration, attendance and audit tests. No duplicate triggers were added.
Trigger work adds cost to writes, so keep it small and transactional; do not call
Redis or other network services from database triggers.

## Subroutines (stored functions)

PostgreSQL distinguishes functions (`SELECT`) from procedures (`CALL`). These
subroutines are **functions**, including functions written in PL/pgSQL.

| Function | Use and benefit |
|---|---|
| `private.register_for_event(uuid)` | Checks membership, event status and capacity, locks the event row and creates/reuses a registration. The database serializes requests for the final seat; a UI-only capacity check would race. The credential trigger then runs automatically. |
| `private.check_in(uuid, text)` + internal `private.record_attendance(...)` | Verifies scanner permission and QR token, then records attendance exactly once using the primary key and `ON CONFLICT`. Repeated scans return an already-checked-in result. |
| **New:** `private.contribution_report(uuid)` | Validates analytics access and returns the summary and ranked members from the multi-table view in one SQL statement. It runs as the caller with RLS, centralizes reporting definitions, and gives the UI and Redis the same structured snapshot. |

## Where pgvector is actually used

1. **Storage/index:** `supabase/migrations/20261103001200_knowledge_base.sql`
   creates `extensions.vector`, `document_chunks.embedding vector(256)` and the
   HNSW cosine index `document_chunks_embedding_hnsw_idx`.
2. **Embedding:** `src/server/search/embeddings.ts` computes 256-dimensional
   vectors with Model2Vec (`potion-base-8M`). The hash fallback is lexical and
   should not be presented as semantic understanding.
3. **Ingestion:** `saveDocument` in `src/server/services/knowledge-base.ts` chunks
   documents and calls `private.save_document`. Feedback/write-ups also create
   embeddings via `submitMemberDocument` in `src/server/services/operations.ts`.
4. **Query:** `searchKnowledgeBase` embeds a query and calls
   `private.search_documents`. SQL combines cosine distance (`<=>`) with
   full-text ranking using Reciprocal Rank Fusion, scoped by organization and
   embedding model under RLS.
5. **UI:** Club → **Knowledge base**, `/o/<slug>/search`.

pgvector helps retrieve related content even when the query uses different
words. It is not used for the contribution score and is not a separate database.

## Contribution report: multiple tables into useful information

Open **Contributions**, `/o/<slug>/leaderboard`, as an analytics reader in a club
with Analytics enabled. The existing URL is preserved.

The underlying `report_member_contributions` view combines **seven distinct tables**:
`organization_memberships`, `profiles`, `event_attendance`, `event_registrations`,
`task_assignments`, `ctf_solves`, and `certificates`. Attendance joins
registrations to identify the participant; assignments join memberships to
identify the volunteer. Each activity is aggregated before the joins so multiple
tasks and attendances do not multiply each other.

The page presents active members, contributors, participation percentage, members
with zero contributions, activity totals, and a per-member ranking. These help
organizers recognize contributions and invite uninvolved members to participate.

Score = `10 × attendances + 20 × completed tasks + CTF points + 5 × certificates`.
Ties share a rank. All figures cover **all-time activity for currently active
members**, not a recent-activity window. The score is an explicit heuristic;
certificates may recognize the same attendance and therefore add extra weight.
Disabled modules can hide their underlying activity through existing RLS.

## Run and verify both stores

For example, run a local Redis instance in a separate terminal:

```sh
docker run --rm --name clubsphere-redis -p 127.0.0.1:6379:6379 redis:7-alpine
```

Set server configuration (or put these in `.env.local`):

```sh
REDIS_URL=redis://127.0.0.1:6379 REDIS_KEY_PREFIX=clubsphere-local npm run demo
```

For Supabase mode, set the same Redis variables with the existing Supabase
configuration and run `npm run dev`. Apply forward migration
`20261105000100_contribution_report.sql` through the normal migration process.
Demo mode applies new migrations automatically. No cloud migration is applied
by editing this repository.

Open Contributions twice, then inspect cache keys without dumping member data:

```sh
docker exec clubsphere-redis redis-cli --scan --pattern 'clubsphere-local:contributions:*'
TEST_REDIS_URL=redis://127.0.0.1:6379/15 npx vitest run test/integration/redis-reports.test.ts
```

The Redis integration test checks an actual miss, JSON round trip, TTL and
malformed-value rejection. The service tests cover warm-cache authorization,
module disablement and tenant separation; product-service tests exercise real
attendance/task/CTF/certificate aggregates. Without `TEST_REDIS_URL`, the live
Redis test is explicitly skipped. Hosted Redis should use authenticated TLS
(`rediss://`), a separate environment prefix and a suitable eviction policy.
