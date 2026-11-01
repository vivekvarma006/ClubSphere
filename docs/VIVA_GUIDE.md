# Viva and review preparation

How to use this guide: read sections 1–4 the night before the review. Then work through the question bank (section 7) **out loud with your teammate**, taking turns asking. Open every file linked from an answer at least once. Examiners usually follow up with "show me where", so you should be able to jump to the code.

> **Be precise about what exists.** Phase 1 (identity, organizations, roles, memberships, audit, reports) is **built and tested**. Events, QR check-in, food distribution, inventory, CTF, certificates and semantic search are **designed** (ER diagram, rules, mechanisms) and are Phase 3 work. Say "designed and scheduled", never "done". Examiners respect a clear plan far more than an overclaim they can disprove in one click.

---

## 1. The pitch

**60 seconds**

> College clubs run on spreadsheets, Google Forms, WhatsApp groups and paper coupons. That causes duplicate registrations, wrong attendance, food wastage and no record of who contributed what. ClubSphere is one platform for club operations: membership, events, QR check-in and food distribution, volunteers, inventory, CTFs and certificates.
>
> It is built **for any club, not one club**. A new club is a row in the database, not a code change, and the **database itself** guarantees that one club can never see or touch another club's data. We use PostgreSQL for the structured, transactional data, and pgvector inside PostgreSQL for semantic search over write-ups and event documents. The interesting part is not CRUD. It is the rules the database enforces: no duplicate memberships or food claims, no privilege escalation, safe concurrent approvals, and a tamper-proof audit trail.

**3-minute walkthrough** (one sentence per point)

1. Problem → fragmented tools → concrete failures (duplicates, food wastage, no contribution tracking).
2. Users: applicants, members, officers, owners; plus platform admins who manage ClubSphere itself.
3. Flow: sign in (Google or email) → choose club → answer that club's questions → pending request → officer approves → member.
4. Data model: 12 tables now, about 25 designed; M:N relationships resolved with associative entities (memberships, membership_roles, role_permissions).
5. Integrity: constraints, composite foreign keys, partial unique index, CHECKs tying status to timestamps.
6. Security: RLS on every table, security-definer procedures, subset rule against escalation, audit triggers.
7. Concurrency: row locks so two officers can't double-approve and two owners can't remove each other.
8. Reports: views with security_invoker; average review time per club, etc.
9. Next: events, QR attendance and food distribution with exactly-once guarantees, then pgvector search.

---

## 2. First review: checklist and evidence

| Reviewer checks | Our evidence | Show this |
|---|---|---|
| **Min 5 tables in ER diagram** | 12 tables implemented, about 25 in the full design | [DATABASE.md §2 and §3](DATABASE.md#2-er-diagram-phase-1-implemented) (Mermaid; export a PNG from mermaid.live for slides) |
| **RDBMS + NoSQL** | PostgreSQL + pgvector (requirements doc **Option 2: SQL + Vector DB**), plus JSONB for semi-structured config | [DATABASE.md §1 and §10](DATABASE.md#1-database-choice-and-justification). ⚠️ Confirm with the instructor that Option 2 satisfies "NoSQL". If not, the MongoDB design for event feedback is ready. |
| **Reports in demo** (like "average salary per department") | 4 report views + 11 demo queries: AVG per org, HAVING, correlated subquery, RANK(), running total, RLS demo | `npm run demo:reports`, [demo_reports.sql](../supabase/queries/demo_reports.sql) |
| **Novelty** | See below | Talk through §3 |

### Demo script (about 8 minutes)

Prepare beforehand: `npm ci`, run `npm test` once (so it's fast), open VS Code with the migrations folder and the ER diagram.

1. **ER diagram** (2 min). Walk Profiles → Memberships ← Organizations; then Roles → Role_Permissions ← Permissions; point at the composite-FK notes. Mention the planned modules diagram.
2. **DDL** (1 min). Open [0600_memberships.sql](../supabase/migrations/20261024000600_memberships.sql): the partial unique index (line 46) and the CHECK that ties status to timestamps (line 33). Optionally paste [ddl_dml_demo.sql](../supabase/queries/ddl_dml_demo.sql) into the Supabase SQL editor: CREATE / ALTER / INSERT / UPDATE / DELETE / DROP inside a rolled-back transaction.
3. **Reports** (2 min). Run `npm run demo:reports`. Read out query 1 (average review time per organization) and explain GROUP BY + AVG. Then queries 9 and 10: the **same view** returns only Alpha for Alpha's owner and only Beta for Beta's owner. That is RLS.
4. **Procedure + transaction** (2 min). Open [`approve_membership_request`](../supabase/migrations/20261024000700_authorization_and_procedures.sql#L435): lock org → check permission → `FOR UPDATE` → status check → insert membership + role → update request, all in one transaction.
5. **Tests** (1 min). Run `npm test`: unit, database and integration tests, many of them *forbidden* cases ("officer of club B cannot approve club A's request"). See TEST_STRATEGY.md for verified counts and concurrency results.

### Novelty: what is different from a typical club-management project

1. **Club-agnostic, multi-tenant by design.** Most projects hardcode one club. Here a new club needs zero code, and isolation is enforced by the **database** (RLS + composite foreign keys + security-invoker views), not by `WHERE` clauses programmers might forget.
2. **Privilege can only flow downward.** The subset rule: you can only grant, assign or suspend what you hold yourself. It is enforced in SQL, so even a buggy UI can't let an officer become an owner.
3. **Race-safe operations.** Org-row locking prevents write skew, and idempotent requests survive double-clicks and retries.
4. **Tamper-proof audit trail.** Written by triggers with the actor taken from the verified session; append-only even for the table owner.
5. **(Designed)** QR check-in and food distribution with **exactly-once** semantics: primary keys make a second scan harmless, and the inventory decrement plus claim plus stock movement happen in one transaction.
6. **(Designed)** Semantic search with pgvector over CTF write-ups and event docs, inside the same RLS boundary, optionally combined with full-text search (hybrid ranking).

---

## 3. Implemented vs planned

| Area | Status |
|---|---|
| Schema: 12 tables, constraints, indexes, RLS, 10 procedures, 4 views, audit triggers | ✅ Built, tested |
| Server layer: verified identity, org access checks, membership services, reports service, error mapping, logging | ✅ Built, tested |
| Auth plumbing: Supabase SSR clients, session refresh, OAuth callback, email-confirm/recovery route | ✅ Built, unit + smoke tested |
| Sign-in / sign-up / onboarding / reviewer screens | ⏳ Phase 2 |
| Events, registrations, QR attendance, food, inventory, volunteers, CTF, certificates | 📐 Designed (DATABASE.md §3), Phase 3 |
| pgvector semantic search | 📐 Designed (DATABASE.md §10), Phase 3 |
| Concurrency tests on real Postgres | ✅ 3 passed on temporary PostgreSQL 18.6 with the Supabase shim (2026-11-02); full Supabase verification still required |

---

## 4. Ten facts to have at your fingertips

1. **Tables:** profiles, platform_admins, organizations, organization_email_domains, organization_profile_fields, permissions, organization_roles, role_permissions, membership_requests, organization_memberships, membership_roles, audit_logs.
2. **M:N relationships:** profiles↔organizations (via memberships), memberships↔roles (via membership_roles), roles↔permissions (via role_permissions).
3. **Default roles per new club:** owner (all 8 permissions), officer (member.read, membership.review, membership.suspend, analytics.read), member (none yet). Seeded by an AFTER INSERT trigger.
4. **Isolation level:** PostgreSQL default, **READ COMMITTED**, made safe with `SELECT … FOR UPDATE` row locks and unique constraints.
5. **Error codes:** custom SQLSTATE class `CS`: CS401, CS403, CS404, CS409, CS422.
6. **Why "not found" for cross-club attempts:** so officers can't discover other clubs' request ids.
7. **Two schemas:** `public` = tables (exposed via the API, RLS everywhere); `private` = procedures (not exposed).
8. **Views use `security_invoker = true`**, otherwise a view runs as its owner and bypasses RLS.
9. **Passwords:** never stored by us. Supabase Auth stores bcrypt hashes; we only see a signed JWT.
10. **Test DB:** PGlite, real PostgreSQL 18 compiled to WebAssembly, so tests need no Docker.

---

## 5. Database design: how to explain it

### ER → relational mapping rules we applied

| ER construct | Relational result | Example |
|---|---|---|
| Strong entity | Table with its own PK | `organizations(id PK)` |
| 1:N relationship | FK on the "many" side | `organization_roles.organization_id → organizations` |
| M:N relationship | Junction table with composite PK = both FKs | `role_permissions(role_id, permission_key)` |
| M:N with attributes | Associative entity with surrogate PK + UNIQUE on the pair | `organization_memberships(id PK, UNIQUE(organization_id, user_id), status, joined_at)` |
| 1:1 | FK that is also the PK | `profiles.id → auth.users.id` |
| Multi-valued attribute | Separate table | email domains → `organization_email_domains` |

### Keys vocabulary, with our examples

- **Super key:** any set of columns that identifies a row, e.g. `{id, slug}` in organizations.
- **Candidate key:** a minimal super key: `{id}` and `{slug}` are both candidates.
- **Primary key:** the chosen candidate: `id` (uuid). **Alternate key:** `slug` (UNIQUE).
- **Composite key:** `(role_id, permission_key)`.
- **Surrogate vs natural key:** `id` is surrogate (no meaning). `slug` is natural but can change, so it is not used as the FK target.
- **Foreign key:** `membership_requests.user_id → profiles.id`.

### Why UUIDs?

Ids appear in URLs and APIs. Sequential integers leak counts ("we're member #12") and are guessable. UUIDs can be generated anywhere without coordination. Cost: 16 bytes and random index inserts, acceptable at this scale. The audit log uses a `bigint identity` because it is append-only, internal and naturally ordered.

### Normalization answer (memorize the shape)

> "The schema is in 3NF. For example, roles are not a comma-separated column on memberships (that would break 1NF); they are a separate `membership_roles` table. Memberships don't store the club's name, which would be a transitive dependency and break 3NF; we join to organizations instead. We have **two deliberate, controlled redundancies**: `organization_id` in `role_permissions` and `membership_roles` is determined by `role_id`/`membership_id`, so technically a partial dependency. We keep it so a composite foreign key can **prove** both sides belong to the same club, and the FK makes inconsistency impossible. And `profiles.email` copies the auth email via a trigger and is never used for security decisions."

---

## 6. Where each advanced feature lives

The course requires at least 4 advanced concepts. We have 8 implemented.

| Concept | Where | One-line explanation |
|---|---|---|
| **Transactions** | [`withUserContext`](../src/server/db/user-context.ts#L18); every procedure | Each operation is all-or-nothing, including its audit rows (test: "roll back everything, including audit rows") |
| **Row locking / concurrency control** | [`lock_organization`](../supabase/migrations/20261024000700_authorization_and_procedures.sql#L176), `FOR UPDATE` at line 461 | Serializes membership changes per club; prevents double approval and write skew |
| **Stored procedures/functions** | [0700](../supabase/migrations/20261024000700_authorization_and_procedures.sql) | 10 SECURITY DEFINER procedures with permission checks inside |
| **Triggers** | [`audit_row_change`](../supabase/migrations/20261024000200_audit_log.sql#L79), [`seed_default_roles`](../supabase/migrations/20261024000500_roles_and_permissions.sql#L93), updated_at, append-only | Automatic auditing, role seeding, immutability |
| **Views** | [0900_reports.sql](../supabase/migrations/20261024000900_reports.sql) | 4 report views, security_invoker |
| **Indexing** | [`membership_requests_queue_idx`](../supabase/migrations/20261024000600_memberships.sql#L51), partial unique index line 46 | Composite index for keyset pagination; partial unique index for "one pending request" |
| **Row level security** | [0800_rls_and_grants.sql](../supabase/migrations/20261024000800_rls_and_grants.sql) | Tenant isolation in the database |
| **Constraints incl. composite FKs** | [`membership_roles_membership_fk`](../supabase/migrations/20261024000600_memberships.sql#L118) | Cross-club references are impossible |
| **Vector similarity search** | 📐 designed | Phase 3 |
| **Full-text search** | 📐 designed (hybrid with vectors) | Phase 3 |

---

## 7. Question bank

Answers are written the way you'd say them. Don't memorize word for word; understand the "because".

### A. Project and design

**Q1. Why isn't this just a CRUD app?**
Because the hard parts are rules the database enforces across rows and users: a person can have one membership per club; a request can be approved only once even if two officers click together; an officer can't grant powers they don't have; one club can never read another's data; every change is audited automatically. Those need constraints, transactions, locks, triggers, procedures and RLS, not just insert/select.

**Q2. What does "club-agnostic" mean concretely?**
There is no club name, domain, logo or role name in the code. A club is a row in `organizations`; its roles, email-domain rules and application questions are rows. `create_organization()` creates a club with default roles in one call. Our tests create two fictional clubs and prove they are isolated.

**Q3. Why one database for all clubs instead of one per club?**
One schema and one deployment are much easier to maintain, migrate and back up. Users can be in several clubs. The cost is that isolation must be enforced carefully, which we do in three layers (application checks, RLS, composite FKs). The other common patterns are schema-per-tenant and database-per-tenant: stronger isolation, but migrations and cross-club users become painful.

**Q4. What is the difference between authentication and authorization here?**
Authentication: Supabase Auth proves who you are (Google or email/password) and gives a signed JWT. Authorization: what you may do *in a given club*, from that club's roles. Signing in alone grants nothing.

**Q5. Why separate `membership_requests` from `organization_memberships`?**
Different lifecycles (pending/approved/rejected/withdrawn vs active/suspended), different visibility (reviewers see requests; member lists show memberships), and history: a rejected request stays as a record while the person may re-apply.

**Q6. How does a platform admin differ from a club owner?**
Platform admins are in a separate table and can create/suspend clubs. They have **no** rights inside a club unless separately made a member there. A test proves a platform admin cannot approve a club's request.

### B. ER, keys and normalization

**Q7. Identify a weak entity.**
None is strictly weak, since every table has its own key. The closest are the junction tables (`membership_roles`, `role_permissions`): their identity is the combination of parent keys, and they cascade-delete with their parents.

**Q8. Total vs partial participation, with an example?**
Every membership must belong to an organization: total participation of memberships (NOT NULL FK). An organization may have no email-domain rows: partial participation.

**Q9. Does JSONB violate 1NF?**
Only if you need to query inside it relationally. `answers` is a snapshot document of one application; we never join on its contents. We still validate it in the DB against the club's field definitions. If we needed per-answer reports, we'd normalize it into `request_answers(request_id, field_id, value)`.

**Q10. What is a functional dependency? Give one from your schema.**
X → Y means X's value determines Y's. `organizations.id → slug, name, status`. `slug → id` too (it's unique). In `role_permissions`, `role_id → organization_id`, which is our deliberate redundancy.

**Q11. BCNF vs 3NF?**
3NF allows a dependency X → A where A is part of a candidate key; BCNF requires every determinant to be a candidate key. Our tables (except the deliberate redundancy) have only key determinants, so they are also BCNF.

### C. SQL

**Q12. WHERE vs HAVING?**
WHERE filters rows before grouping; HAVING filters groups after aggregation. Demo query 2: `WHERE status = 'pending' … GROUP BY org HAVING count(*) >= 2`.

**Q13. Logical order of evaluation of a SELECT?**
FROM/JOIN → WHERE → GROUP BY → HAVING → SELECT → DISTINCT → ORDER BY → LIMIT. That's why a SELECT alias can't be used in WHERE. In Postgres, ORDER BY can use a bare alias but not an alias inside an expression (we hit exactly this in demo query 6).

**Q14. COUNT(\*) vs COUNT(column)?**
COUNT(\*) counts rows; COUNT(col) counts non-NULL values. In `report_role_distribution` we use `count(m.id)` after a LEFT JOIN so roles with no members show 0, not 1.

**Q15. Why LEFT JOIN in the role report?**
To keep roles that nobody holds; an INNER JOIN would drop them.

**Q16. Correlated vs non-correlated subquery?**
A correlated subquery references the outer row and is (logically) evaluated per row. Demo query 4 compares each request's wait with *its own club's* average. A non-correlated one runs once.

**Q17. EXISTS vs IN?**
EXISTS stops at the first match and handles NULLs sanely. `NOT IN` with a NULL in the list returns no rows. Our policies use EXISTS.

**Q18. RANK vs DENSE_RANK vs ROW_NUMBER?**
For ties 10, 10, 8: RANK gives 1, 1, 3; DENSE_RANK gives 1, 1, 2; ROW_NUMBER gives 1, 2, 3.

**Q19. What does `FILTER (WHERE …)` do?**
A conditional aggregate: `count(*) filter (where status = 'approved')` counts only approved rows within the group. It's cleaner than `sum(case when … then 1 else 0 end)`.

**Q20. DELETE vs TRUNCATE vs DROP?**
DELETE removes chosen rows (WHERE allowed, fires row triggers, scans the table). TRUNCATE removes all rows at once (no WHERE, no row triggers, fires TRUNCATE triggers; our audit log blocks it). DROP removes the table itself. All three are transactional in Postgres, so they can be rolled back, unlike in some other databases.

**Q21. Show an ALTER.**
In [ddl_dml_demo.sql](../supabase/queries/ddl_dml_demo.sql): `add column`, `add constraint … unique`, `alter column … set default`, `rename column`. In the migrations: `alter table … enable row level security`, `alter default privileges`.

### D. Constraints and integrity

**Q22. Where do you validate input at the database level?**
CHECK constraints (slug format, name length, status values, status-timestamp consistency), NOT NULL, UNIQUE and partial UNIQUE, composite FKs, and `validate_profile_answers()` for club-specific questions. The app validates first with Zod for friendly messages, but the DB is the final authority.

**Q23. Explain the partial unique index.**
`UNIQUE (organization_id, user_id) WHERE status = 'pending'`. A person can have many old (rejected/withdrawn) requests but only **one pending** request per club. A normal UNIQUE would prevent re-applying after rejection.

**Q24. What is a composite foreign key and why use it?**
An FK on several columns: `(organization_id, role_id) → organization_roles(organization_id, id)`. Because `membership_roles` has two such FKs sharing `organization_id`, the membership and the role must be in the same club. A query bug cannot attach club B's "officer" role to someone in club A.

**Q25. ON DELETE CASCADE vs SET NULL vs RESTRICT: where did you use each?**
CASCADE: deleting a user removes their profile, requests and memberships. SET NULL: deleting a reviewer keeps the request but clears `reviewed_by`. NO ACTION/RESTRICT: a request referenced by a membership can't be deleted on its own. The audit log has no FKs at all, so history survives deletions.

**Q26. Why CHECK instead of ENUM?**
Easy to change with ALTER; Postgres can't drop a value from an ENUM without recreating the type.

### E. Transactions and concurrency (examiners love this)

**Q27. ACID, with your examples?**
- **Atomicity:** approve = insert membership + insert role + update request + audit rows, all or nothing.
- **Consistency:** constraints hold after every transaction (e.g. approved ⇒ reviewed_at set).
- **Isolation:** concurrent approvals don't interfere (locks).
- **Durability:** once committed, it's in the WAL and survives crashes.

**Q28. What isolation level do you use? Why is it safe?**
READ COMMITTED (the Postgres default). By itself it allows lost updates and write skew, so critical paths take explicit row locks (`SELECT … FOR UPDATE`) and rely on unique constraints. Alternatively we could use SERIALIZABLE and retry on serialization failure (40001); our error mapper already treats 40001 as "try again".

**Q29. Two officers click Approve on the same request at the same moment. Walk me through it.**
Both call `approve_membership_request`. Each first locks the club's row; the second **waits**. The first locks the request, sees `pending`, creates the membership, marks it approved and commits. The second then proceeds, re-reads the request under its lock, sees `approved`, and raises CS409 "already been approved". Even without locks, `UNIQUE(organization_id, user_id)` on memberships would stop a duplicate.

**Q30. What is write skew? Where could it happen in your system?**
Two transactions each read the same condition, then write different rows, and together they break a rule neither broke alone. Example: the club has two owners; each tries to suspend the other. Each checks "another active owner remains" (true for both) and both succeed, leaving no owner. We prevent it by locking the club's row first, so they run one after another and the second finds its caller already suspended.

**Q31. Dirty read, non-repeatable read, phantom?**
Dirty: reading uncommitted data (never happens in Postgres). Non-repeatable: the same row read twice gives different values. Phantom: the same query returns new rows the second time. READ COMMITTED allows the last two; REPEATABLE READ (snapshot) prevents both in Postgres; SERIALIZABLE also prevents write skew.

**Q32. How does Postgres implement isolation?**
MVCC: each row version has creating/deleting transaction ids, and each statement (or transaction, in REPEATABLE READ) sees a snapshot. Readers don't block writers. Writers on the same row do block each other, which is why `FOR UPDATE` works as a lock.

**Q33. Could your locks deadlock?**
We always lock in the same order (club row, then target row), which avoids lock-order deadlocks between our procedures. If one did happen, Postgres detects it, aborts one transaction with 40P01, and we map that to "try again".

**Q34. How do you prevent duplicate requests from a double-click?**
The procedure first returns any existing pending request. If two inserts race, the partial unique index rejects one; the procedure catches `unique_violation` and returns the winner's id. So it is idempotent: same input, same result, no duplicate.

**Q35. (Phase 3) How will you stop two people claiming the same food coupon, or food being given when stock is out?**
`food_claims` primary key `(registration_id, meal_slot_id)` blocks a second claim. Stock: `UPDATE inventory_items SET quantity = quantity - 1 WHERE id = $1 AND quantity > 0`. If it updates 0 rows, we're out. Plus `CHECK (quantity >= 0)`. The claim, the stock update and a `stock_movements` row are in one transaction.

### F. Triggers, procedures, views

**Q36. BEFORE vs AFTER triggers? Row vs statement?**
BEFORE can modify or reject the row (our `set_updated_at`, `prevent_audit_mutation`). AFTER sees the final row and is used for side effects (audit, role seeding). Row-level fires per row; statement-level once per statement (our TRUNCATE guard).

**Q37. Why audit with triggers instead of in application code?**
A trigger can't be forgotten. It fires for every write path, including manual SQL by an admin. The actor comes from `auth.uid()`, so a client can't forge it. Demo query 8 shows even our seed script's direct UPDATEs were recorded.

**Q38. Function vs procedure in Postgres?**
`CREATE PROCEDURE` (called with CALL) can COMMIT inside; it can't be used in SELECT. `CREATE FUNCTION` returns values and runs inside the caller's transaction. We use functions because they return ids and the caller controls the transaction.

**Q39. What is SECURITY DEFINER and what is the risk?**
The function runs with its owner's privileges, so it can write tables the caller can't. That is how membership writes are restricted to our procedures. Risk: a malicious object earlier on the `search_path` could hijack unqualified names. Fix: `SET search_path = ''` and fully qualified names. A test checks every definer function has it.

**Q40. What is a view? Updatable? Materialized?**
A stored query. Simple single-table views are auto-updatable. A materialized view stores results and must be refreshed, which is good for heavy reports (planned for contribution scores). By default a view runs with its **owner's** rights and would bypass RLS, so ours use `security_invoker = true`.

### G. Indexes and performance

**Q41. Which index types exist and where would you use each?**
B-tree (default: equality, ranges, sorting: most of ours). Hash (equality only). GIN (JSONB, arrays, full-text `tsvector`). GiST (ranges, geometry). BRIN (huge tables ordered by time, e.g. a large audit log). HNSW / IVFFlat (pgvector approximate nearest neighbour).

**Q42. Explain your composite index and the leftmost-prefix rule.**
`(organization_id, status, applied_at, id)` serves "pending requests of club X, oldest first, page after (t, id)". It can be used for queries filtering on `organization_id`, or `organization_id + status`, but not on `status` alone.

**Q43. Why keyset pagination instead of OFFSET?**
`OFFSET 10000` still reads and discards 10,000 rows, and pages shift when rows are inserted. Keyset (`WHERE (applied_at, id) > ($t, $id)`) jumps straight there using the index and is stable. We keep `applied_at` as text in the cursor so microseconds aren't lost.

**Q44. When does an index hurt?**
Every INSERT/UPDATE must maintain it (slower writes, more storage), and it's useless for low-selectivity filters. Check with `EXPLAIN ANALYZE`.

**Q45. Why connection pooling? What's special about Supabase's pooler?**
Postgres connections are expensive and serverless functions open many. The transaction pooler shares connections between requests, but a connection may change between transactions, so we disable prepared statements (`prepare: false`) and use only `SET LOCAL` (transaction-scoped).

### H. Security, auth and RLS

**Q46. What is RLS? USING vs WITH CHECK?**
Row Level Security adds a per-row filter to every query on a table for given roles. USING decides which existing rows are visible or affectable (SELECT/UPDATE/DELETE). WITH CHECK validates new or changed rows (INSERT/UPDATE). Table owners and BYPASSRLS roles skip RLS, which is why our procedures (owned by postgres) can write.

**Q47. If RLS exists, why check permissions in the app too?**
Defense in depth and better errors. The app check gives "You do not have permission" early; RLS and procedures are the guarantee if the app has a bug. Neither alone is the plan.

**Q48. Can a user fake their organization or user id?**
The user id comes only from a verified JWT (`getClaims()`), and we put it into the DB session ourselves. The organization comes from the URL slug looked up on the server and, inside procedures, from the target row. A request id from club B under club A's URL returns "not found" (tested).

**Q49. How are passwords stored?**
Not by us. Supabase Auth stores bcrypt hashes (salted, deliberately slow). We never see passwords. Credentials are environment variables, never in code, never prefixed `NEXT_PUBLIC_`.

**Q50. What's in a JWT, and why `getClaims()` not `getSession()`?**
Header.payload.signature (base64url). The payload has `sub` (user id), `role`, `exp` and so on. `getSession()` just reads the cookie, which could be tampered with; `getClaims()` verifies the signature (locally with the project's public keys when asymmetric keys are enabled).

**Q51. What is OAuth PKCE?**
The app creates a random `code_verifier`, sends its SHA-256 (`code_challenge`) to the provider, and later exchanges the returned one-time `code` plus the verifier for tokens. Someone who steals the code can't use it without the verifier. Our `/auth/callback` does the exchange.

**Q52. How do you prevent SQL injection?**
Every query is parameterized (Drizzle's `sql` template / postgres.js send values separately from SQL text). No string concatenation, and no dynamic SQL in procedures.

**Q53. What's an open redirect and how do you stop it?**
`/auth/callback?next=https://evil.com` would bounce a freshly logged-in user to a phishing site. `safeNextPath()` allows only same-site paths and rejects `//host`, backslashes and control characters (tested).

**Q54. Why not do authorization in Next.js middleware/proxy?**
It runs before routing and can be skipped or misconfigured. In 2025 a Next.js bug (CVE-2025-29927) let attackers bypass middleware with a header. Our proxy only refreshes sessions; every service re-verifies.

**Q55. What if the service-role key leaks?**
It bypasses RLS, so it's critical, which is why the app doesn't use it at all. It lives only in a password manager for admin scripts. If leaked: rotate it in Supabase, audit logs, check for changes.

**Q56. Pre-account takeover?**
An attacker registers your email with a password before you sign up with Google. Supabase links identities by email but removes unconfirmed identities when linking, and we require a confirmed email before any membership request. We never merge accounts in our code.

### I. Vector / NoSQL

**Q57. What is an embedding?**
A list of numbers (e.g. 384 floats) produced by a model so that texts with similar meaning are close together in that space.

**Q58. Cosine vs Euclidean vs inner product? pgvector operators?**
Cosine measures the angle (ignores length), Euclidean (L2) the straight-line distance, inner product the dot product. pgvector: `<=>` cosine distance, `<->` L2 distance, `<#>` negative inner product. Similarity = 1 − cosine distance.

**Q59. HNSW vs IVFFlat?**
Both are approximate nearest-neighbour indexes. HNSW is a layered graph: better speed/recall, slower to build, more memory, and it can be built on an empty table. IVFFlat clusters vectors into lists and searches the nearest lists: faster to build, but it needs data first and tuning (`lists`, `probes`).

**Q60. Why pgvector instead of Pinecone/Qdrant?**
The texts belong to clubs and must obey the same isolation rules. With pgvector, vectors are rows: same RLS, same transactions, joins with events/challenges, one backup, no sync job. A dedicated vector DB wins at very large scale (hundreds of millions of vectors), which we don't have.

**Q61. Why not MongoDB for everything?**
Our core data is relational with strict cross-row rules (unique memberships, no double claims, stock never negative). Postgres gives constraints, joins and multi-row ACID transactions natively. MongoDB fits documents whose shape varies (that's our fallback design for event feedback forms) but we'd have to rebuild tenant isolation in the app.

**Q62. CAP theorem / ACID vs BASE?**
Under a network partition, a distributed system must choose between consistency and availability. ACID systems favor consistency; BASE (basically available, soft state, eventually consistent) favors availability. A club platform needs consistency for claims and approvals, so ACID.

### J. Testing

**Q63. How do you test RLS?**
In a transaction we `SET LOCAL ROLE authenticated` and set the JWT claims exactly as Supabase does, then query as different fixture users: officer of A, officer of B, a user who is officer in A but only member in B. We assert who sees what and who gets "permission denied".

**Q64. How do you know your tests actually test something?**
We broke the org check in `has_org_permission` on purpose; the cross-club tests failed; then we restored it. And many tests assert *forbidden* outcomes, not just success.

**Q65. What is PGlite and why use it?**
PostgreSQL compiled to WebAssembly, running inside Node. Tests use real Postgres behaviour (plpgsql, triggers, RLS) without Docker, and each test gets a clean cloned database. Limitation: one connection, so race tests need a real server (`test/concurrency`).

### K. Cross-questions ("gotchas")

**Q66. Your audit log has no foreign keys. Isn't that bad design?**
Deliberate. Logs must outlive what they mention; a deleted user's history must remain. `ON DELETE SET NULL` would itself UPDATE the log, which our append-only rule forbids.

**Q67. You copy email into profiles. Isn't that redundant?**
Yes, and it's controlled: a trigger keeps it in sync, users can't edit it, and no security decision uses it. Eligibility reads the verified `auth.users.email` (a test proves editing the copy doesn't help).

**Q68. What if an officer is suspended while approving?**
Both operations lock the club row, so they're ordered. If the suspension commits first, the approval's permission check (which runs after the lock) fails.

**Q69. How would this scale to 100 clubs?**
Same schema. Every hot query is scoped by `organization_id` with indexes that lead with it. Next steps when needed: read replicas for reports, materialized views for heavy analytics, time-partitioned audit logs.

**Q70. What would you do differently?**
Honest options: move permissions into JWT custom claims for fewer DB lookups (with care about staleness); add rate limiting; add a Content-Security-Policy; run the concurrency suite in CI with a Postgres service container.

---

## 8. Practice: write these queries yourself, then check

1. Number of active members per club, highest first.
   <details><summary>Answer</summary>

   ```sql
   select o.name, count(*) as members
     from organization_memberships m join organizations o on o.id = m.organization_id
    where m.status = 'active'
    group by o.name
    order by members desc;
   ```
   </details>

2. Clubs whose approval rate is below 80%.
   <details><summary>Answer</summary>

   ```sql
   select organization_id,
          round(100.0 * count(*) filter (where status = 'approved') / count(*), 1) as rate
     from membership_requests
    where status in ('approved', 'rejected')
    group by organization_id
   having 100.0 * count(*) filter (where status = 'approved') / count(*) < 80;
   ```
   </details>

3. Members who hold more than one role in the same club.
   <details><summary>Answer</summary>

   ```sql
   select m.organization_id, m.user_id, count(*) as roles
     from membership_roles mr join organization_memberships m on m.id = mr.membership_id
    group by m.organization_id, m.user_id
   having count(*) > 1;
   ```
   </details>

4. Applicants who were rejected and then applied again to the same club.
   <details><summary>Answer</summary>

   ```sql
   select distinct r1.organization_id, r1.user_id
     from membership_requests r1
     join membership_requests r2
       on r2.organization_id = r1.organization_id and r2.user_id = r1.user_id
      and r2.applied_at > r1.applied_at
    where r1.status = 'rejected';
   ```
   </details>

5. For each club, the reviewer with the most decisions (use a window function).
   <details><summary>Answer</summary>

   ```sql
   select organization_id, reviewed_by, decisions from (
     select organization_id, reviewed_by, count(*) as decisions,
            rank() over (partition by organization_id order by count(*) desc) as rnk
       from membership_requests where reviewed_by is not null
      group by organization_id, reviewed_by) t
    where rnk = 1;
   ```
   </details>

---

## 9. Team contribution

The requirements say **both** members must contribute to **both** database and application work, and Git history must show it. Split by vertical feature, not "DB person / UI person":

| Member 1 | Member 2 |
|---|---|
| Identity + organizations + roles migrations (0300–0500) | Memberships + procedures migrations (0600–0700) |
| RLS policies + `rls-isolation` tests | Reports views + demo queries + `reports` tests |
| Auth routes, proxy, session (`src/app/auth`, `src/server/auth`) | Services + error mapping (`src/server/services`, `errors.ts`) |
| Phase 3: events, registrations, QR attendance | Phase 3: food distribution, inventory, pgvector search |

Commit your own parts from your own Git account, in small commits with meaningful messages ("add partial unique index for pending requests"), not one giant commit. Each of you must be able to explain the **other's** part too; examiners often ask the quieter member about the code the louder one presented.

---

## 10. Known limitations: say these before you're asked

- UI screens for sign-in/onboarding/review are Phase 2; Phase 1 is the secure foundation.
- Concurrency tests are written but haven't run against a real Postgres yet.
- No rate limiting or Content-Security-Policy yet.
- Performance targets are defined but not measured.
- Whether "NoSQL" in the checklist accepts pgvector is being confirmed with the instructor.
