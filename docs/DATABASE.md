# Database design

The SQL in [`supabase/migrations/`](../supabase/migrations) is the source of truth. This document explains it.

- [1. Database choice and justification](#1-database-choice-and-justification)
- [2. ER diagram: Phase 1 (implemented)](#2-er-diagram-phase-1-implemented)
- [3. ER diagram: full system (implemented)](#3-er-diagram-full-system)
- [4. Relational schema and data dictionary](#4-relational-schema-and-data-dictionary)
- [5. Constraints that enforce business rules](#5-constraints-that-enforce-business-rules)
- [6. Normalization](#6-normalization)
- [7. Indexes](#7-indexes)
- [8. Triggers, functions and procedures](#8-triggers-functions-and-procedures)
- [9. Views and reports](#9-views-and-reports)
- [10. Vector / NoSQL component](#10-vector--nosql-component)
- [11. Migrations and rollback](#11-migrations-and-rollback)

---

## 1. Database choice and justification

The course asks for a choice justified by the shape of the data, not technology for its own sake.

| Data | Store | Why |
|---|---|---|
| Users, organizations, roles, memberships, requests, audit log (Phase 1); events, registrations, attendance, food claims, inventory, stock movements, tasks, certificates (Phase 3) | **PostgreSQL tables** | Highly related data with rules that must never be broken: one membership per person per club, no duplicate food claim, no negative stock. These need foreign keys, unique/check constraints and multi-row **ACID transactions**. Reports need joins and aggregates. |
| Per-club configuration (branding, feature switches), membership application answers whose questions differ per club | **PostgreSQL JSONB** columns | The shape varies by organization. JSONB keeps it flexible while the database still guarantees "is a JSON object", the procedure `private.validate_profile_answers` checks answers against the club's field definitions, and Zod schemas type it in the app. |
| CTF challenge descriptions, write-ups, event documentation, feedback text (built: `documents`, `document_chunks`) | **pgvector** (vector columns in PostgreSQL) | Users need to search by *meaning* ("SQL injection walkthrough" should find a write-up titled "Bypassing a login form"). Keeping vectors next to the relational rows means the same RLS isolation, transactions and joins apply to search, with no second database to keep in sync. |

**Current design: PostgreSQL (RDBMS) + Redis (NoSQL key-value database), with pgvector inside PostgreSQL for search.** Redis stores disposable contribution-report snapshots for 30 seconds. PostgreSQL JSONB and pgvector are PostgreSQL features; neither is presented as a separate NoSQL database. See [§10](#10-vector--nosql-component) and [the walkthrough](DATABASE_WALKTHROUGH.md).

---

## 2. ER diagram: Phase 1 (implemented)

12 tables, all created by the migrations and covered by tests. `auth.users` belongs to Supabase Auth.

```mermaid
erDiagram
    AUTH_USERS ||--|| PROFILES : "has"
    PROFILES ||--o| PLATFORM_ADMINS : "may be"
    PROFILES ||--o{ ORGANIZATION_MEMBERSHIPS : "holds"
    ORGANIZATIONS ||--o{ ORGANIZATION_MEMBERSHIPS : "has members"
    PROFILES ||--o{ MEMBERSHIP_REQUESTS : "applies"
    ORGANIZATIONS ||--o{ MEMBERSHIP_REQUESTS : "receives"
    PROFILES |o--o{ MEMBERSHIP_REQUESTS : "reviews"
    MEMBERSHIP_REQUESTS |o--o| ORGANIZATION_MEMBERSHIPS : "results in"
    ORGANIZATIONS ||--o{ ORGANIZATION_ROLES : "defines"
    ORGANIZATION_MEMBERSHIPS ||--o{ MEMBERSHIP_ROLES : "is assigned"
    ORGANIZATION_ROLES ||--o{ MEMBERSHIP_ROLES : "assigned via"
    ORGANIZATION_ROLES ||--o{ ROLE_PERMISSIONS : "carries"
    PERMISSIONS ||--o{ ROLE_PERMISSIONS : "granted via"
    ORGANIZATIONS ||--o{ ORGANIZATION_EMAIL_DOMAINS : "accepts"
    ORGANIZATIONS ||--o{ ORGANIZATION_PROFILE_FIELDS : "asks"

    AUTH_USERS {
        uuid id PK
        text email UK
        timestamptz email_confirmed_at
        boolean is_anonymous
    }
    PROFILES {
        uuid id PK "FK auth.users"
        text email "trigger-maintained copy"
        text display_name
        text avatar_url
    }
    PLATFORM_ADMINS {
        uuid user_id PK "FK profiles"
        uuid granted_by FK
        timestamptz granted_at
    }
    ORGANIZATIONS {
        uuid id PK
        text slug UK
        text name
        text status "active|suspended|archived"
        text onboarding_policy
        jsonb branding
        jsonb settings
    }
    ORGANIZATION_EMAIL_DOMAINS {
        uuid organization_id PK "FK"
        text domain PK
    }
    ORGANIZATION_PROFILE_FIELDS {
        uuid id PK
        uuid organization_id FK
        text field_key "UK with org"
        text field_type
        boolean is_required
        jsonb options
    }
    PERMISSIONS {
        text key PK
        text description
    }
    ORGANIZATION_ROLES {
        uuid id PK
        uuid organization_id FK
        text role_key "UK with org"
        boolean is_system
        boolean is_default
    }
    ROLE_PERMISSIONS {
        uuid role_id PK "composite FK with org"
        text permission_key PK "FK"
        uuid organization_id FK
    }
    MEMBERSHIP_REQUESTS {
        uuid id PK
        uuid organization_id FK
        uuid user_id FK
        text status "pending|approved|rejected|withdrawn"
        jsonb answers
        timestamptz applied_at
        timestamptz reviewed_at
        uuid reviewed_by FK
        text rejection_reason
    }
    ORGANIZATION_MEMBERSHIPS {
        uuid id PK
        uuid organization_id FK "UK with user"
        uuid user_id FK
        text status "active|suspended"
        uuid source_request_id FK
        timestamptz suspended_at
    }
    MEMBERSHIP_ROLES {
        uuid membership_id PK "composite FK with org"
        uuid role_id PK "composite FK with org"
        uuid organization_id
        uuid assigned_by FK
    }
    AUDIT_LOGS {
        bigint id PK "identity"
        timestamptz occurred_at
        uuid actor_id "no FK by design"
        uuid organization_id "no FK by design"
        text action
        jsonb metadata
    }
```

**Cardinalities in words**

- A person (profile) can belong to **many** organizations and an organization has **many** members: an M:N relationship resolved by the associative entity `organization_memberships`, which carries its own attributes (status, joined_at, suspension details).
- A membership can hold **many** roles and a role can be held by **many** memberships: M:N via `membership_roles`.
- A role carries **many** permissions and a permission appears in **many** roles: M:N via `role_permissions`.
- An organization **defines** its own roles (1:N). Roles are never shared between organizations.
- A membership request **may result in** at most one membership (1:0..1, `source_request_id`).
- `audit_logs` is deliberately not linked by foreign keys (see §5).

> To export this as an image for slides: paste the Mermaid block into https://mermaid.live and download PNG/SVG. GitHub also renders it directly.

---

## 3. ER diagram: full system

The current schema contains **31 public tables**. The twelve foundation tables are shown above; role templates, events, credentials, attendance, knowledge-base storage and the remaining product modules are implemented in migrations `20261103001000`–`20261103002000`. `private.request_limits` is internal counter storage and has no API table grants.

```mermaid
erDiagram
    ROLE_TEMPLATES ||--o{ ROLE_TEMPLATE_PERMISSIONS : defaults
    PERMISSIONS ||--o{ ROLE_TEMPLATE_PERMISSIONS : grants
    ORGANIZATIONS ||--o{ EVENTS : runs
    EVENTS ||--o{ EVENT_REGISTRATIONS : accepts
    PROFILES ||--o{ EVENT_REGISTRATIONS : registers
    EVENT_REGISTRATIONS ||--|| REGISTRATION_CREDENTIALS : owns
    EVENT_REGISTRATIONS ||--o| EVENT_ATTENDANCE : checks_in
    ORGANIZATIONS ||--o{ INVENTORY_ITEMS : stocks
    INVENTORY_ITEMS ||--o{ STOCK_MOVEMENTS : adjusts
    INVENTORY_ITEMS ||--o{ MEAL_SLOTS : supplies
    EVENTS ||--o{ MEAL_SLOTS : serves
    MEAL_SLOTS ||--o{ FOOD_CLAIMS : claimed
    EVENT_REGISTRATIONS ||--o{ FOOD_CLAIMS : consumes
    EVENTS |o--o{ VOLUNTEER_TASKS : supports
    VOLUNTEER_TASKS ||--o{ TASK_ASSIGNMENTS : assigns
    ORGANIZATION_MEMBERSHIPS ||--o{ TASK_ASSIGNMENTS : completes
    EVENTS ||--o{ CTF_CHALLENGES : contains
    CTF_CHALLENGES ||--o{ CTF_ATTEMPTS : receives
    PROFILES ||--o{ CTF_ATTEMPTS : attempts
    CTF_CHALLENGES ||--o{ CTF_SOLVES : awards
    PROFILES ||--o{ CTF_SOLVES : solves
    EVENT_REGISTRATIONS ||--o| CERTIFICATES : certifies
    EVENTS ||--o{ EVENT_FEEDBACK : receives
    PROFILES ||--o{ EVENT_FEEDBACK : submits
    DOCUMENTS ||--o{ EVENT_FEEDBACK : indexes
    DOCUMENTS |o--o{ CTF_SOLVES : explains
    ORGANIZATIONS ||--o{ DOCUMENTS : owns
    DOCUMENTS ||--o{ DOCUMENT_CHUNKS : embeds
```

| Table | Keys and invariant |
|---|---|
| `role_templates`, `role_template_permissions` | Default roles as data; `register_permission` backfills system roles in existing clubs |
| `events` | `(organization_id,id)` unique; end after start; positive capacity; draft/published/completed/cancelled |
| `event_registrations` | Unique `(event_id,user_id)`, `(event_id,id)`, `(organization_id,id)`; event row lock serializes capacity checks |
| `registration_credentials` | PK `registration_id`; unique 64-hex random token, readable only by registrant |
| `event_attendance` | PK `registration_id`; composite event/registration FK; exactly-once attendance |
| `inventory_items` | `(organization_id,id)` unique; quantity `CHECK >= 0`; only movement trigger changes stock |
| `stock_movements` | UUID PK; signed nonzero delta; immutable to API roles; AFTER INSERT updates the item under row lock |
| `meal_slots` | UUID PK; composite FKs to event and item in the same club; unique `(event_id,name)` |
| `food_claims` | PK `(registration_id,meal_slot_id)`; composite FKs enforce both the same event and club; claim and movement commit together |
| `volunteer_tasks` | UUID PK, organization scope, optional event, title/description, due time |
| `task_assignments` | PK `(task_id,membership_id)`; same-club composite FKs; only assignee completes; replay preserves `completed_at` |
| `ctf_challenges` | UUID PK, same-club event; points 1–10000; `flag_hash` is native PostgreSQL SHA-256 (`bytea`, 32 bytes) with no column SELECT grant |
| `ctf_attempts` | UUID PK; caller, challenge, correctness, timestamp; submitted flags never persisted |
| `ctf_solves` | PK `(challenge_id,user_id)`; points snapshot; optional linked write-up document |
| `certificates` | Unique registration and random verification code; printed recipient/event/club names are snapshots |
| `event_feedback` | Unique `(event_id,user_id)`; rating 1–5, nonempty comment, linked indexed document |
| `documents`, `document_chunks` | Composite tenant FK; per-document chunk positions; 256-dimensional vectors, generated English full-text index |

`claim_meal` requires a registered, checked-in attendee, a published event, enabled inventory, and `food.distribute`. The organization lock serializes claims; the claim PK makes replay idempotent. A failed stock CHECK rolls back the claim, movement, quantity update and audit entries.

`submit_flag` accepts active members only while a CTF event is published and in its time window. A solve can award points once. Solvers publish write-ups only after the event ends, preventing live answer disclosure. Feedback requires a checked-in, completed event. Member documents and chunks are inserted in the same transaction as the feedback/solve link.

`ctf_scoreboard` ranks totals per club/event using `RANK()`. `report_member_contributions` pre-aggregates attendance, completed tasks, CTF points and certificates, avoiding join multiplication, then ranks the weighted scores per club. All report views use `security_invoker=true`. The leaderboard requires `analytics.read`; custom roles may see RLS-limited totals without profile/member-read permissions.

API roles have no direct writes to the new product tables. Optional modules default off; `module_enabled` and `require_module` enforce active membership, active club and settings in SQL. Public certificate verification is the only intentional anonymous capability: a definer function returns four printed fields for an unguessable valid code, with no anonymous table access.

---

## 4. Relational schema and data dictionary

Notation: **PK** primary key, **FK** foreign key, **UK** unique. Full column definitions are in the migrations.

| Table | Purpose | Key columns and rules |
|---|---|---|
| `profiles` | One per auth user, organization-independent | PK `id` → `auth.users(id)` ON DELETE CASCADE. `display_name` 1–100 chars. `avatar_url` must be https. `email` is a trigger-maintained copy, **not** user-updatable. |
| `platform_admins` | Who may create/suspend organizations | PK `user_id` → profiles. No API write path. |
| `organizations` | A club or organization | PK `id` (uuid). UK `slug` (3–50 chars, `a-z0-9-`, no `--`). `status` ∈ active/suspended/archived. `onboarding_policy` ∈ approval_required/invite_only/closed. `branding`, `settings` JSONB objects. |
| `organization_email_domains` | Optional eligibility rule | PK `(organization_id, domain)`. Domain format CHECK. |
| `organization_profile_fields` | Club-specific application questions | UK `(organization_id, field_key)`. `field_type` ∈ text/long_text/number/select/url. `options` required exactly when type = select. |
| `permissions` | Capability catalog | PK `key` (e.g. `membership.review`). Seeded by migration. |
| `organization_roles` | Roles belonging to one organization | UK `(organization_id, role_key)`, UK `(organization_id, id)` (target for composite FKs). Partial UK: one `is_default` role per org. |
| `role_permissions` | Permissions carried by a role | PK `(role_id, permission_key)`. Composite FK `(organization_id, role_id)` → `organization_roles(organization_id, id)`. |
| `membership_requests` | Applications to join | Partial UK `(organization_id, user_id) WHERE status = 'pending'`. CHECKs tie `reviewed_at`/`withdrawn_at`/`rejection_reason` to `status`. |
| `organization_memberships` | Approved members | UK `(organization_id, user_id)`. `status` ∈ active/suspended. CHECK: suspended ⇔ `suspended_at` set. Composite FK to the source request in the same org. |
| `membership_roles` | Roles held by a membership | PK `(membership_id, role_id)`. Two composite FKs sharing `organization_id`, so membership and role must be in the same org. |
| `audit_logs` | Append-only change history | PK `id` bigint identity. `action` format CHECK. `metadata` object ≤ 4 KB. |

---

## 5. Constraints that enforce business rules

| Business rule | Enforced by |
|---|---|
| A person can't have two memberships in one club | `UNIQUE (organization_id, user_id)` on memberships |
| No duplicate pending requests, even from simultaneous double-clicks | Partial unique index `WHERE status = 'pending'` + procedure catches `unique_violation` and returns the existing request |
| A role from club B can't be attached in club A | Composite FKs on `membership_roles` and `role_permissions` |
| Review metadata matches status (can't be "approved" without a review time) | Multi-column CHECK `membership_requests_review_consistent` |
| A rejection reason only exists on rejected requests | CHECK `membership_requests_reason_only_on_reject` |
| One default role per organization | Partial unique index on `organization_roles (organization_id) WHERE is_default` |
| Audit history can't be edited or deleted | BEFORE UPDATE/DELETE row trigger + BEFORE TRUNCATE statement trigger raise `CS403`; privileges revoked |
| Audit history survives account deletion | **No FK** on `audit_logs.actor_id`. An `ON DELETE SET NULL` would itself be an UPDATE of the log. |
| Deleting a user cleans up their data | `ON DELETE CASCADE` from `auth.users` → `profiles` → requests/memberships; reviewer references use `ON DELETE SET NULL` |

**Why CHECK constraints instead of ENUM types?** Adding or removing allowed values in a CHECK is a simple `ALTER TABLE`. Removing a value from a Postgres ENUM is not supported without recreating the type.

---

## 6. Normalization

The schema is in **3NF**, with two deliberate, controlled exceptions.

- **1NF**: every column holds one value. Roles are not stored as a comma-separated list on the membership; they get their own table (`membership_roles`).
- **2NF**: in tables with composite keys, non-key columns depend on the whole key. `membership_roles.assigned_at` depends on (membership, role) together.
- **3NF**: no non-key column depends on another non-key column. Memberships don't store the organization's name; it is joined from `organizations`.

**Deliberate exceptions (and why they are safe)**

1. `role_permissions.organization_id` and `membership_roles.organization_id` are determined by `role_id` / `membership_id` alone, a partial dependency that technically breaks 2NF. They exist so that a **composite foreign key** can prove both sides belong to the same organization, and so RLS policies can filter without extra joins. They cannot become inconsistent: the composite FK rejects any mismatch, and ids never change.
2. `profiles.email` duplicates `auth.users.email`. It is maintained by a trigger and is never used for security decisions; eligibility checks read `auth.users`.

**JSONB and 1NF.** `membership_requests.answers` is treated as one atomic value: a snapshot of an application form whose questions differ per club. It is never queried relationally. If per-answer reporting were needed, it would be normalized into `request_answers(request_id, field_id, value)`.

---

## 7. Indexes

| Index | Serves |
|---|---|
| `organization_memberships (organization_id, user_id)` UNIQUE | Permission checks (`has_org_permission`), member lists |
| `organization_memberships (user_id)` | "Which organizations am I in?" |
| `membership_requests (organization_id, status, applied_at, id)` | Reviewer queue with keyset pagination: `WHERE org = $1 AND status = 'pending' AND (applied_at, id) > ($2, $3) ORDER BY applied_at, id` |
| `membership_requests (organization_id, user_id) WHERE status = 'pending'` UNIQUE | Duplicate prevention (and a fast lookup) |
| `membership_requests (user_id, applied_at desc)` | Applicant status page |
| `membership_roles (role_id)`, `role_permissions` PK `(role_id, permission_key)` | Joins in `has_org_permission` |
| `audit_logs (organization_id, occurred_at desc)` partial | Audit screen, newest first |
| `audit_logs (actor_id, occurred_at desc)` partial | Investigations by person |

Composite index column order follows the **leftmost-prefix rule**: the queue index starts with `organization_id` because every query is scoped to one organization.

Implemented: GIN on `tsvector` for full-text search and **HNSW** (`vector_cosine_ops`) on `document_chunks.embedding`. For very large audit logs, BRIN on `occurred_at` or time partitioning.

---

## 8. Triggers, functions and procedures

**Triggers** ([0200](../supabase/migrations/20261024000200_audit_log.sql) … [0600](../supabase/migrations/20261024000600_memberships.sql))

| Trigger | Timing | Purpose |
|---|---|---|
| `*_set_updated_at` | BEFORE UPDATE, row | Sets `updated_at = now()` |
| `on_auth_user_created` | AFTER INSERT on `auth.users` | Creates the profile (never a membership) |
| `on_auth_user_email_changed` | AFTER UPDATE OF email | Syncs `profiles.email` |
| `organizations_seed_default_roles` | AFTER INSERT on organizations | Creates owner/officer/member roles and their permissions, so a new club needs no code |
| `*_audit` (8 tables) | AFTER INSERT/UPDATE/DELETE, row | Writes `audit_logs` via `private.audit_row_change()`, a SECURITY DEFINER function, with the actor from `auth.uid()` |
| `audit_logs_no_update_delete` / `audit_logs_no_truncate` | BEFORE, row / statement | Makes the log append-only |

**Procedures** (PostgreSQL functions in schema `private`, [0700](../supabase/migrations/20261024000700_authorization_and_procedures.sql))

`request_membership`, `withdraw_membership_request`, `approve_membership_request`, `reject_membership_request`, `suspend_membership`, `reinstate_membership`, `assign_role`, `revoke_role`, `create_organization`, `set_organization_status`.

They are `SECURITY DEFINER` with `SET search_path = ''`, which prevents search-path hijacking. Each one follows the same order: identify the actor → derive the organization from the target row → lock the organization row → check permission → lock and validate the target → write. Audit rows are added by triggers in the same transaction.

We use `CREATE FUNCTION` rather than `CREATE PROCEDURE` because these return values (new ids) and are called with `SELECT`. Transaction control stays with the caller.

---

## 9. Views and reports

All views use `WITH (security_invoker = true)` so RLS on the underlying tables applies to the caller, and they return rows only where the caller holds `analytics.read`.

| View | Shows | SQL features |
|---|---|---|
| `report_org_membership_summary` | Active/suspended members, pending/approved/rejected requests, approval rate | CTEs, `COUNT(*) FILTER`, `LEFT JOIN`, `NULLIF` |
| `report_review_turnaround` | Average / median / max hours to review, per organization | `AVG`, `percentile_cont(0.5) WITHIN GROUP`, `GROUP BY` |
| `report_role_distribution` | Active members per role, including empty roles | `LEFT JOIN` + `COUNT(col)` |
| `report_monthly_applications` | Applications per month by outcome | `date_trunc`, `GROUP BY` |
| `report_event_attendance` | Registration, attendance and fill rates per event | Pre-aggregated CTEs, `NULLIF` |
| `ctf_scoreboard` | Points and shared ranks per club/event | `SUM`, `RANK()` |
| `report_member_contributions` | Attendance, task, CTF and certificate totals per active member | Pre-aggregated CTEs, weighted score, `RANK()` |

Further demo queries (HAVING, correlated subquery, `RANK()`, running totals) are in [`supabase/queries/demo_reports.sql`](../supabase/queries/demo_reports.sql). `npm run demo:reports` runs them on sample data.

**Why aggregate in CTEs before joining?** Joining organizations → memberships → requests in one go multiplies rows (memberships × requests per org) and inflates counts. Pre-aggregating each side avoids this "fan-out" problem.

---

## 10. Vector / NoSQL component

### pgvector (built: migration `20261103001200_knowledge_base.sql`)

| Question the course asks | Answer |
|---|---|
| What becomes an embedding? | Knowledge-base documents (CTF write-ups, guides, event documents, feedback summaries, minutes), split into chunks of about 700 characters on paragraph and sentence boundaries; each chunk is prefixed with its document title |
| Which model? | `minishlab/potion-base-8M` (Model2Vec, MIT licence): a **static** embedding model distilled from the BGE-base transformer. Every token has a learned 256-number vector; a text's embedding is the mean of its token vectors, normalized to length 1. Runs in pure TypeScript in the Next.js server (no GPU, no native code, ~30 MB, ~0.1 ms per text), downloaded once by `npm run models:download` (pinned revision, SHA-256 checked). Without it the app falls back to lexical hash embeddings (`hash-v1`). |
| How are vectors stored? | `document_chunks.embedding extensions.vector(256)` with `embedding_model` (vectors from different models are never compared), alongside `organization_id`, `document_id`, `content` and a generated `tsvector` column. Same RLS as other club data. |
| Similarity metric | Cosine distance (`<=>` operator); similarity = 1 − distance |
| Retrieval | `private.search_documents()` (SECURITY INVOKER, so RLS applies): top 40 chunks by cosine distance (HNSW index) and top 40 by `ts_rank_cd` full-text rank (GIN index), merged with a FULL OUTER JOIN and scored by Reciprocal Rank Fusion `1/(60+rank)`; semantic matches below 0.3 similarity are dropped unless the words also match; best chunk per document. |

### Redis (implemented NoSQL component)

`src/server/cache/reports.ts` stores a validated JSON snapshot under a tenant/user/permissions/settings-scoped key with `SET ... EX 30`. `getContributionReport` checks live PostgreSQL permissions and the analytics switch before **every** cache read. A cache miss calls `private.contribution_report(uuid)` and caches the result outside the SQL transaction. Cache failure falls back to PostgreSQL. Configure `REDIS_URL` to activate the second database; without it, reports still work but the application is only using PostgreSQL.

This is a read-heavy, recomputable projection, so bounded staleness is acceptable. Membership, stock, attendance, roles and audit records remain transactional SQL data. Redis does not make authorization decisions. Use an environment-specific `REDIS_KEY_PREFIX` and authenticated TLS Redis in hosted environments. See [setup and demo commands](DATABASE_WALKTHROUGH.md).

---

## 11. Migrations and rollback

- Migrations are plain SQL files in Supabase CLI format, applied in filename order. Each runs as one transaction: all of it or none.
- **Forward-only in production.** Mistakes are fixed with a new migration. Before applying a migration to production, take a backup (Supabase PITR on paid plans, or `supabase db dump`).
- [`supabase/rollback/20261024_foundation_down.sql`](../supabase/rollback/20261024_foundation_down.sql) removes the whole Phase 1 foundation for development resets. A test runs *up → down → up* to prove the migrations are reversible and re-runnable on a clean database.


## 12. Event waitlists (2026-11-09)

Migration `20261109000100_event_waitlists.sql` adds `event_waitlist` with tenant-consistent event references, one entry per event/user, an identity sequence for FIFO ordering, RLS and audit triggers. Members read their own entries; event managers can read their club's queue. Writes are limited to authorized procedures. `my_event_waitlist` reveals only the caller's status and position, without exposing other members.

Registration, cancellation, queue joins/leaves and capacity changes serialize on the event row. Cancellation locks the event before its registration row. The internal `promote_event_waitlist` routine fills available places for active memberships, reuses cancelled registrations when needed, and uses the existing private QR credential machinery. Known ineligible memberships are recorded explicitly; unexpected errors roll back the entire operation. Capacity cannot be reduced below existing registrations. Cancelled/completed events close waiting entries, and promotion stops at event start.

Personal activity reads use the authenticated user context and explicit user predicates even for managers with broader RLS visibility. Disabled task/certificate modules and suspended memberships/clubs are excluded. Report visuals reuse the existing security-invoker views, without another database or chart dependency.
