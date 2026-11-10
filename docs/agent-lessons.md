# Project lessons

## 2026-11-05: Verify styles when changing the build engine

- **Failure:** A webpack production build compiled successfully but omitted Tailwind utilities because the loader was configured only for Turbopack. Browser checks found 503 px of content in a 390 px viewport.
- **Rule:** When using a fallback build engine, verify its CSS processing, rendered layout and computed styles before treating it as equivalent. Compilation alone does not prove a usable build.
- **Verified:** Both build paths now configure the existing Tailwind loader; the webpack output contains generated utilities, and the mobile browser regression passes at 390 px.

## 2026-11-05: Complete authorized local service setup

- **Failure:** Handed Redis startup and environment configuration back to the user after implementing the cache, despite local tooling being available.
- **Cause:** Treated a sandbox network restriction as a user-owned setup task instead of using the supported approval flow.
- **Rule:** For an authorized local integration, inspect available services, request necessary tool escalation, preserve existing configuration, and verify a real round trip before handing off. Distinguish local setup from hosted account provisioning.
- **Verified:** Started the local Redis-compatible service and configured the ignored `.env.local`; integration test results are reported in the task.

## 2026-11-02: Check redirects after URL normalization

- **Failure:** `/a/..//evil.example` passed the raw same-site check but normalized into a protocol-relative path, causing an off-site auth redirect.
- **Rule:** Validate the normalized pathname as well as the original input. Check the final redirect destination in route tests, including encoded dot segments.
- **Verified:** Regression tests reproduced the external redirect before the fix and pass after it.

## 2026-11-02: Authorize cascading effects at the parent

- **Failure:** Deleting a custom role bypassed child-table RLS and removed permissions and assignments that the caller could not revoke directly.
- **Rule:** Include cascading effects when checking parent DELETE permissions. Preserve deployed migrations by adding a forward migration, and update rollback dependency order when a policy references another table.
- **Verified:** Restricted deletion, authorized deletion, and rollback/re-apply tests pass.

## 2026-11-03: Serialize arrays explicitly in raw Drizzle SQL

- **Failure:** Interpolating a JavaScript permission array in a raw `sql` template generated a SQL tuple, causing malformed-array and record-cast errors in custom-role updates.
- **Rule:** For raw SQL array parameters, use a parameterized JSON array with `array(select jsonb_array_elements_text(...::jsonb))`, or an explicitly supported driver encoding. Do not assume `${values}::text[]` binds one array.
- **Verified:** Service tests exercise single- and multiple-permission custom roles through Drizzle on PGlite, including rollback of a forbidden replacement.

## 2026-11-03: Wait for authentication navigation in browser tests

- **Failure:** An E2E helper navigated to login before the sign-out Server Action completed. Under load, login saw the old session and redirected to the dashboard, leaving the test waiting for another identity's button.
- **Rule:** Await the resulting auth redirect before issuing another navigation. A click completing is not proof that its asynchronous Server Action committed.
- **Verified:** The helper explicitly waits for `/login`; all seven Chromium workflows pass after the fix.

## 2026-11-09: Serialize memory-heavy local verification

- **Failure:** Ran the PGlite test suite alongside browser verification and local database setup; the user reported an OOM kill and had to resume the task.
- **Cause:** Scheduled independent checks concurrently without accounting for their combined memory use. PGlite workers and browser/server processes each carry substantial memory overhead.
- **Rule:** On this local machine, run the full PGlite suite with `--maxWorkers=1`, then browser checks and builds separately. Finish or stop one heavy check before starting another; keep only the services needed by the current check running.
- **Verified:** The single-worker suite passed (322 tests), followed separately by 17 Chromium workflows, lint/typecheck and five real PostgreSQL concurrency checks, without another reported OOM.
