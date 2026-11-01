# Test strategy

**Principle:** forbidden operations are first-class test cases. Every permission rule has a test showing who *cannot* do something, especially across organizations.

## Layers

| Suite | Location | Runs on | What it proves |
|---|---|---|---|
| Database | `test/db/*.test.ts` | PGlite (PostgreSQL 18 compiled to WASM) + `supabase-shim.sql` | Migrations apply on a clean DB; constraints, triggers, procedures, RLS, grants, views and audit behave as designed; rollback → re-apply works; Drizzle mirror matches the schema |
| Integration | `test/integration` | PGlite through Drizzle | The real service layer (Zod → `withUserContext` → RLS → procedures → error mapping) |
| Unit | `test/unit` | Node | Auth callback/confirm routes (Supabase faked), JWT-claims validation, safe redirects, error mapping, log redaction, env and config schemas |
| Concurrency | `test/concurrency` | **Real Postgres** (`TEST_DATABASE_URL`) | Simultaneous duplicate requests, simultaneous approvals, mutual owner suspension (write skew) |
| E2E | `test/e2e` | Playwright against `next start` | HTTP smoke (pages, redirects, headers, health). Browser auth flows are tracked as `fixme` until the Phase 2 screens exist |

## Fixtures

`buildWorld()` in `test/db/fixtures.ts` creates two organizations (`alpha-society`, `beta-circle`) through the real procedures:

- owner, officer and member in each,
- **crossUser**: officer in alpha, *member only* in beta,
- a verified applicant with no memberships, and an unverified user,
- a platform admin with no organization roles.

The world is built once per test file and **cloned** (PGlite `clone()`, about 250 ms) for each test, so tests never share state.

## Coverage of the required scenarios

| Requirement | Test(s) |
|---|---|
| Email verification required before requesting | `membership-flow` "rejects users whose email is not verified"; `auth-routes` confirm route |
| Password recovery | `auth-routes` recovery redirect; `password-update` action authentication, validation, safe errors; HTTP smoke for signed-out recovery page. Full email/provider browser flow remains E2E fixme |
| Google / OAuth callback | `auth-routes` callback cases (success, provider error, missing code, replayed code, open redirect) |
| Pending / active / rejected / suspended states | `membership-flow`, `suspension-and-roles`, `constraints-and-audit` (state CHECKs) |
| Approval and rejection permissions | `membership-flow` "reviewing requests" |
| Unauthorized role escalation | `suspension-and-roles` "role assignment and escalation", "editing role permissions directly" |
| Role deletion cascades | `suspension-and-roles` "deleting custom roles": permission subset, role.assign requirement, authorized deletion |
| Redirect normalization | `safe-redirect` dot-segment cases; `auth-routes` normalized protocol-relative redirect |
| Health deadlines | `health-route` successful, failed, and stalled queries; timer cleanup |
| Duplicate membership requests | `membership-flow` idempotency; `constraints-and-audit` partial unique index; `concurrency` |
| Repeated and concurrent approvals | `membership-flow` second approval → CS409; `services` CONFLICT mapping; `concurrency` (real PG) |
| Cross-organization access | `rls-isolation`, `membership-flow` (officerB, crossUser), `services` (replayed ids), `suspension-and-roles` |
| Access after suspension | `suspension-and-roles` "removes a suspended officer's permissions immediately" |
| Another user's private profile / request | `rls-isolation` "private data of other users" |
| RLS on every exposed table | `migrations` (RLS enabled everywhere, anon has nothing) + per-table policy tests in `rls-isolation` |
| Constraints and transaction rollback | `constraints-and-audit` |
| Account-linking edge cases | Supabase-side behaviour, documented in THREAT_MODEL T3; E2E fixme |
| Migrations against a clean DB | `migrations` (every run starts from an empty PGlite) |

## Checking that tests can fail

During development, the org-scoping condition in `private.has_org_permission` was deliberately broken. The cross-organization tests failed as expected, and the original file was restored byte for byte. Repeat this kind of mutation check when changing authorization code.

## Running

```bash
npm test                     # unit + db + integration (concurrency skipped without TEST_DATABASE_URL)
npm run test:db              # database suite only
npx playwright test          # e2e (run `npm run build` first)
```

Concurrency suite against a local Supabase stack (Docker required):

```bash
npx supabase start
npx supabase db reset        # applies supabase/migrations
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run test/concurrency
```

## Last verified run

On 2026-11-02 (local, Linux, Node 22): **210 tests passed** across separate runs: 61 unit, 146 database/integration (one worker to limit memory use), and 3 concurrency tests on temporary PostgreSQL 18.6 with the Supabase shim. ESLint, type checking, and the production build passed; HTTP Playwright smoke passed 8/8. No real Supabase credentials were used. Full browser auth/provider flows remain unverified.
