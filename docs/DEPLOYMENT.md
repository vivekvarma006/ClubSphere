# Deployment

**Assumed platform:** Vercel (Next.js) + Supabase (Auth + Postgres). Any Node host that runs `next start` works the same way.

## Environments

| | Development | Staging | Production |
|---|---|---|---|
| Supabase project | local (`supabase start`) or a dev project | separate project | separate project |
| Hosting | `npm run dev` | Vercel Preview (branch deploys) | Vercel Production (`main`) |
| `APP_ENV` | `development` | `staging` | `production` |
| Data | fixtures / throwaway | synthetic only | real |
| Google OAuth client | dev client, localhost redirect | staging client | production client |

Each environment has its **own** Supabase project, keys, OAuth client and `DATABASE_URL`. Never point staging at production data.

## Environment variables (per environment, in the host's settings)

| Variable | Secret? | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | no | Inlined at **build** time; set it before building |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | no | Inlined at build time |
| `APP_URL` | no | Public HTTPS origin for signup, recovery and Google callbacks |
| `DATABASE_URL` | **yes** | Transaction pooler, least-privilege login role (below) |
| `DATABASE_POOL_MAX` | no | 3–5 per serverless instance |
| `APP_ENV`, `LOG_LEVEL` | no | |

The Supabase **service-role key is not configured in the app** at all.

## Least-privilege database role

Run once per project in the SQL editor, with a generated password:

```sql
create role clubsphere_app login password '<generated>' noinherit;
grant authenticated, anon to clubsphere_app; -- verified operations / public certificate lookup
```

`noinherit` means the login role has **no privileges of its own**. Queries work only after `withUserContext` runs `SET LOCAL ROLE authenticated` (or the certificate lookup sets `anon`), so a code path that forgot to switch role fails instead of running with elevated rights. Connect through the pooler as `clubsphere_app.<project-ref>`.

> Verify in each project before relying on it: create the role, set `DATABASE_URL`, and check that `/api/health` and a membership operation work. (`select 1` runs without table privileges; the membership call is the real test.) Until verified, the app can connect as `postgres`, and it still switches to `authenticated` in every transaction.

## Release procedure

1. CI on the pull request: lint, typecheck, tests, build, e2e smoke ([`ci.yml`](../.github/workflows/ci.yml)).
2. Merge to `main`.
3. **Migrations first**, then code. Migrations must be backward compatible with the currently deployed code (add columns as nullable or with defaults; remove in a later release).
   ```bash
   npx supabase link --project-ref <staging-ref> && npx supabase db push
   # verify staging, then:
   npx supabase link --project-ref <prod-ref> && npx supabase db push
   ```
   Take a backup before the production push (PITR on paid plans, or `npx supabase db dump -f backup.sql`).
4. Vercel deploys `main`. Check `/api/health` on the production URL.

## Rollback and recovery

| Situation | Action |
|---|---|
| Bad application deploy | Vercel "Instant rollback" to the previous deployment (schema unchanged) |
| Bad migration | Write a **forward-fix** migration. Down scripts are for development only. |
| Data loss or corruption | Restore from PITR or from the pre-migration dump into a new project, verify, then switch `DATABASE_URL` |

Each migration runs in a single transaction, so a migration that fails part-way leaves the schema unchanged.

## Production checklist

- [ ] Separate Supabase project; migrations applied; `select count(*) from public.permissions` returns 16
- [ ] Auth: Site URL and redirect URLs set to the production domain; "Confirm email" on; email templates point to `/auth/confirm`; custom SMTP configured (Supabase's default sender is rate-limited)
- [ ] Google OAuth production client with the production redirect URI
- [ ] Asymmetric JWT signing keys enabled
- [ ] `clubsphere_app` role created and verified
- [ ] First platform admin and club created with the bootstrap script
- [ ] Backups / PITR enabled
- [ ] Uptime monitor on `/api/health`
- [ ] `test/concurrency` run against staging


## Optional modules and release verification

Apply migrations through `20261103002000_request_limits.sql` before deploying this version. Enable inventory, volunteers, CTF, certificates, feedback and analytics per club under Settings. Existing clubs keep them disabled; fresh demo seeds enable them. Public verification needs `anon` role membership on the application login, but grants it no table access.

`npm run build && npm run test:e2e:demo` runs a fresh isolated offline browser database; it never resets an existing demo database. Staging must separately verify email delivery, confirmation, recovery, Google OAuth, the least-privilege login and real multi-connection concurrency with pgvector. The `v1.0` source tag belongs on the reviewed implementation commit. It is a local source checkpoint; production deployment still requires the staging and operational checks above.

The nonce CSP makes pages dynamic. Inline styles remain permitted for per-club CSS branding; production scripts require a nonce and do not permit eval. OAuth form redirects allow the exact origin in `NEXT_PUBLIC_SUPABASE_URL`, including custom domains and a local Supabase stack.
