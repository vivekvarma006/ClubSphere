# Test strategy

**Principle:** forbidden operations are first-class test cases. Every permission rule has a test showing who *cannot* do something, especially across organizations.

## Layers

| Suite | Location | Runs on | What it proves |
|---|---|---|---|
| Database | `test/db/*.test.ts` | PGlite (PostgreSQL 18 compiled to WASM) + `supabase-shim.sql` | Migrations apply on a clean DB; constraints, triggers, procedures, RLS, grants, views and audit behave as designed; rollback → re-apply works; Drizzle mirror matches the schema |
| Integration | `test/integration` | PGlite through Drizzle | The real service layer (Zod → `withUserContext` → RLS → procedures → error mapping) |
| Unit | `test/unit` | Node | Auth callback/confirm routes (Supabase faked), JWT-claims validation, safe redirects, error mapping, log redaction, env and config schemas |
| Concurrency | `test/concurrency` | **Real Postgres** (`TEST_DATABASE_URL`) | Simultaneous duplicate requests, approvals, mutual owner suspension, meal replay and last-stock races |
| E2E | `test/e2e` | Playwright against `next start` | HTTP smoke (pages, redirects, headers, health); Chromium demo flows in an isolated offline database. Real provider email/OAuth scenarios still require staging |

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
npx playwright test          # HTTP smoke / configured Supabase tests (build first)
npm run test:e2e:demo         # Chromium flows on a fresh isolated offline database
```

Concurrency suite against a local Supabase stack (Docker required):

```bash
npx supabase start
npx supabase db reset        # applies supabase/migrations
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run test/concurrency
```

## Last verified run

On 2026-11-02 (local, Linux, Node 22): **210 tests passed** across separate runs: 61 unit, 146 database/integration (one worker to limit memory use), and 3 concurrency tests on temporary PostgreSQL 18.6 with the Supabase shim. ESLint, type checking, and the production build passed; HTTP Playwright smoke passed 8/8. No real Supabase credentials were used. Full browser auth/provider flows remain unverified.

On 2026-11-03 (local, Windows, Node 22.21), after the Review-1 prototype: **247 passed, 3 skipped** (concurrency suite, needs `TEST_DATABASE_URL`) across 20 files, including the new `events`, `knowledge-base` and `demo-seed` database suites. ESLint and `tsc` clean, `next build` successful, HTTP Playwright smoke 8/8. The prototype screens were verified manually in a browser in demo mode (sign-in, approve request, register, QR display, scanner check-in and duplicate scan, semantic search, reports, permission-based 404s). Browser automation for these flows is on the [roadmap](ROADMAP.md). Concurrency runs now need Postgres with the `vector` extension.


## Product module verification (2026-11-03)

- `product-modules.test.ts`: stock rollback and replay, cross-club references, assignee-only completion, hidden CTF hashes, exactly-once scoring, solver write-ups, public certificate field allow-list, feedback eligibility, aggregate scores, suspension/feature gates and durable quotas.
- `administration.test.ts`: settings transactions, custom-role permission replacement/deletion, escalation denial, member scoping and platform-only operations.
- `product-services.test.ts`: the complete module workflow through Drizzle, chunk embeddings, public verification under `anon`, and failed scans consuming their budget.
- `login-actions.test.ts` and `content-security-policy.test.ts`: auth input validation, safe redirects, sanitized errors, configured callbacks and production nonce rules.
- `demo-flows.spec.ts`: real Chromium forms, inventory/meal scanner, task completion, permission-based 404s, CTF scoreboard, feedback search, certificate verification, settings questions, role lifecycle and suspension. It uses a fresh temporary database and never resets `.demo-data`.

PGlite workers are capped at two to bound WASM memory in CI. Browser tests use hash embeddings so they need no model download. Physical-camera behavior and live Supabase provider/email delivery remain separate environment-dependent checks.

Release-source verification on 2026-11-03 (Linux, Node 22.22.2): **299 Vitest tests passed; 4 real-Postgres tests skipped** without `TEST_DATABASE_URL`. **7/7 Chromium demo flows** and **9/9 HTTP smoke checks** passed. ESLint, TypeScript, production build and lockfile clean-install dry-run passed. Mobile layout at 390 px was checked for overflow and visually inspected. Supabase provider/email delivery, physical-camera capture and multi-connection Postgres verification remain environment-dependent.

## Thorough local verification (2026-11-05)

**310/310 Vitest cases passed across 28 files, zero skipped**, with
`TEST_DATABASE_URL` pointing to an isolated PostgreSQL 18.6 database with pgvector
and the Supabase shim, and `TEST_REDIS_URL` pointing to local Valkey. This includes
all four real multi-connection race tests, three live Redis cases, and a service
test using the installed Model2Vec model and pgvector.

**16/16 Chromium demo workflows and 9/9 HTTP smoke checks passed.** The expanded
browser suite covers platform administration, new-account onboarding through
approval/withdrawal, successful QR check-in/replay, owner/officer/volunteer/member
access across 15 club routes per role, cross-club denial, forged sessions and
sign-out. No uncaught browser errors were observed. At 390 px, tasks,
contributions, reports, members, settings, inventory and scanning have no
page-level horizontal overflow. Task and contribution screenshots were inspected.

ESLint, standalone typechecking, diff whitespace checks and the production build
with `npm run build -- --webpack` pass. Fixed webpack's missing Tailwind loader
and excluded generated test artifacts from linting. Default Turbopack still
encounters worker port-binding restrictions in this tool environment.

Six live Supabase provider browser scenarios remain skipped/fixme, and physical
camera capture remains unverified. The local auth shim and mocked provider tests
do not certify real Supabase delivery/OAuth behavior. Full evidence, fixes and
remaining limitations: [QA report](QA_REPORT_2026-11-05.md).


## 2026-11-09: activity, report visuals and event waitlists

`test/db/event-waitlists.test.ts` covers FIFO/rejoining, promotion and QR privacy, eligibility, capacity changes, closure, cross-club denial and failure rollback. `test/integration/activity-and-waitlists.test.ts` covers personal activity ownership/module/active-club boundaries and the real service promotion path. The real PostgreSQL suite adds competing last-seat registrations, concurrent duplicate queue joins and cancellation racing with registration. The browser suite adds the complete waitlist-to-QR workflow plus desktop/mobile activity and reports screenshots.

Local verification: 322 tests passed with seven service-dependent skips; the five PostgreSQL concurrency checks were then run separately and passed. All 17 Chromium workflows, lint, typecheck, webpack production build, migration/rollback/reapply, schema agreement and diff checks passed. Two Redis integration checks were not rerun. See [the dated evidence](QA_REPORT_2026-11-09.md) and [visual tour](VISUAL_TOUR.md). To limit memory use on the local machine, run `npm test -- --maxWorkers=1`, wait for completion, and run browser/build checks separately.

Demo-data follow-up: `demo-seed.test.ts` now has eight cases covering ready-to-try activity/waitlist fixtures, existing-data upgrades, idempotency/preservation, disabled modules and demo-only gating. A new first browser workflow checks Ananya's task/certificate/waitlist and Rohan's robotics task/promoted QR. All eight seed cases and all 18 browser workflows pass; the saved local demo was also checked directly without a reset. The production build, lint and typecheck pass after these changes.
