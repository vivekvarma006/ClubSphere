# Threat model: authentication, authorization and organization isolation

Scope: Phase 1 foundation. Method: list assets and trust boundaries, then walk STRIDE categories (Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege) for each boundary.

## Assets

1. Club data belonging to one organization (members, applications, answers, audit history).
2. Authority inside a club (who can approve, suspend, assign roles).
3. Platform authority (create/suspend clubs).
4. User sessions and credentials (handled by Supabase Auth; ClubSphere never sees passwords).
5. Privileged secrets: database connection string, Supabase service-role key.

## Trust boundaries

```
Browser ──(1)──▶ Next.js server ──(2)──▶ PostgreSQL
   │                    │
   └──(3)──▶ Supabase Auth ◀──(4)── Next.js server (getClaims / code exchange)
```

1. Untrusted input: URL, form data, cookies, headers.
2. The server connects with a pooled credential, then drops to `authenticated` per transaction.
3. OAuth / email-link flows run between the browser and Supabase Auth.
4. The server verifies tokens issued by Supabase Auth.

The browser can also talk to the Supabase Data API directly with the publishable key. **This is treated as hostile**: everything it can reach is limited by GRANTs and RLS.

## Threats and mitigations

| # | Threat | STRIDE | Mitigation | Verified by |
|---|---|---|---|---|
| T1 | Forged or tampered session cookie | S | Identity from `getClaims()` (JWT signature verification), never `getSession()`. Branded `VerifiedActor` type. | `auth-routes.test.ts` (claims validation) |
| T2 | Anonymous Supabase session treated as a user | S | `is_anonymous` rejected in app; `require_actor()` rejects anonymous users in DB | `membership-flow.test.ts` "rejects anonymous sessions" |
| T3 | Pre-account takeover: attacker registers victim's email with a password, victim later signs in with Google | S/E | Supabase links identities by email and **removes unconfirmed identities** on linking. ClubSphere never merges accounts itself and keys everything on the auth UUID. Membership requests require `email_confirmed_at`. | Supabase behaviour (documented); `membership-flow.test.ts` unverified-email cases; E2E linking case tracked as fixme |
| T4 | Open redirect via `?next=` after login | S/I | `safeNextPath()` allows same-site paths only | `safe-redirect.test.ts`, `auth-routes.test.ts`, e2e smoke |
| T5 | Replayed OAuth code / double-click on callback | T | Code is single-use at Supabase; a failed exchange with an existing session continues; otherwise error page | `auth-routes.test.ts` |
| T6 | User changes `organization_id` in a request to act on another club | E | Server never accepts an org id: org comes from the URL slug (looked up server-side) and, inside procedures, from the target row. Request id replayed under another club's slug → not found. | `services.test.ts` "replayed under another organization's route" |
| T7 | Officer of club A acts in club B | E | `has_org_permission(org_of_target, perm)`. Roles are per organization; composite FKs stop cross-org role attachment. | `membership-flow.test.ts`, `rls-isolation.test.ts` (crossUser cases) |
| T8 | Reading another club's data through the Data API with the publishable key | I | RLS on every table (test fails otherwise); `anon` has no privileges; views use `security_invoker` | `migrations.test.ts`, `rls-isolation.test.ts` |
| T9 | Report views leak all clubs' data (views bypass RLS by default) | I | `security_invoker = true` + `analytics.read` filter | `migrations.test.ts`, `reports.test.ts` |
| T10 | Enumerating another club's request/member ids | I | Cross-org attempts return "not found", same as nonexistent ids | `membership-flow.test.ts` |
| T11 | Self-escalation: officer adds permissions to own role, assigns owner role, or edits owner role | E | Subset rule in procedures and `role_permissions` policies; owner role immutable via API; `is_system` not writable | `suspension-and-roles.test.ts` |
| T12 | Writing memberships/roles directly, bypassing review | E/T | No INSERT/UPDATE/DELETE privileges on membership tables for API roles | `suspension-and-roles.test.ts` "direct writes … impossible" |
| T13 | Public sign-up grants officer/admin | E | Sign-up trigger creates only a profile; memberships only via approval; platform admins only via service role/SQL | `membership-flow.test.ts` "creates a profile but no membership" |
| T14 | Email-domain rule bypassed by editing profile email | S | Domain checked against `auth.users.email` (verified), not `profiles.email`; profile email column not writable | `membership-flow.test.ts` "checks the Auth email" |
| T15 | Suspended member keeps acting | E | Permissions require `status = 'active'`; checked per operation, not cached | `suspension-and-roles.test.ts` |
| T16 | Race: two reviewers approve the same request; two owners suspend each other | T/E | Org-row lock + target-row `FOR UPDATE`; status re-checked after lock; unique constraints as backstop | `concurrency.test.ts` (real Postgres; **not yet run**); sequential repeat tests (PGlite) |
| T17 | Duplicate requests from retries | T | Partial unique index + idempotent procedure | `membership-flow.test.ts`, `concurrency.test.ts` |
| T18 | Forged or erased audit trail | R | Actor from `auth.uid()` inside a SECURITY DEFINER trigger; no write privileges; append-only triggers (even for owner) | `constraints-and-audit.test.ts` |
| T19 | Secrets or personal data in audit logs / app logs | I | Audit stores ids and column names only; logger redacts credential keys; Drizzle error messages (which contain SQL params) never logged or shown | `constraints-and-audit.test.ts`, `errors-and-logging.test.ts` |
| T20 | Database errors / stack traces shown to users | I | `toAppError()` maps to fixed messages; only `CS4xx` procedure messages (written for users) pass through | `errors-and-logging.test.ts`, `services.test.ts` |
| T21 | SQL injection | T/E | Parameterized queries only (Drizzle `sql` template / postgres.js); procedures use `search_path = ''` and no dynamic SQL | Code review; no string-built SQL in `src/` |
| T22 | `search_path` hijack of SECURITY DEFINER functions | E | Every definer function pins `search_path = ''` | `migrations.test.ts` |
| T23 | Role/claims leaking between pooled connections | E | `SET LOCAL` / `set_config(..., true)`: scoped to the transaction | Design; `withUserContext` |
| T24 | Session cookie cached by a CDN and served to another user | I | `@supabase/ssr` no-store headers applied in `proxy.ts` | Code review |
| T25 | Clickjacking / MIME sniffing | T | `X-Frame-Options: DENY`, `nosniff`, HSTS, no `X-Powered-By` | e2e smoke "security headers" |
| T26 | Relying on the proxy for authorization (bypass like CVE-2025-29927) | E | Proxy only refreshes sessions; every service re-verifies | Architecture |
| T27 | Service-role key or DB URL leaked | E/I | Server-only env vars; not prefixed `NEXT_PUBLIC_`; service role unused by the app; least-privilege DB login role in production | `.env.example`, DEPLOYMENT.md |
| T28 | Request floods (sign-up spam, request spam) | D | Supabase Auth rate limits; one pending request per club per user. **No app-level rate limiting yet.** | Residual risk |

## Residual risks and known limitations

1. **Concurrency tests have not been run** in this environment (no Postgres server available). Run `test/concurrency` against `supabase start` before relying on T16.
2. **No Content-Security-Policy yet.** Planned with the Phase 2 UI, once third-party origins are known.
3. **No application rate limiting** on membership requests or reviews beyond Supabase Auth's own limits.
4. **Least-privilege DB role** (`clubsphere_app`) is documented but must be created and verified in each Supabase project. Until then, the app connects as `postgres` and relies on `SET LOCAL ROLE authenticated` in every transaction.
5. **Browser E2E auth flows** (Google OAuth, email verification, recovery, identity linking) are specified but not automated until the Phase 2 screens exist.
6. **Report accuracy for custom roles**: a custom role with `analytics.read` but without `member.read`/`membership.review` would see partial totals (RLS-limited, never another club's data).
7. **Audit log growth**: no retention or partitioning policy yet.
8. **Supabase shim**: DB tests emulate the parts of Supabase the schema uses. Behaviour differences are possible; staging verification against real Supabase is required before production.
