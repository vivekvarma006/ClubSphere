# Setup (development)

## Prerequisites

- Node.js **22.12+** and npm
- Git
- Optional: Docker Desktop, only for running a full local Supabase stack (`npx supabase start`)

## 1. Install and verify without any cloud account

```bash
npm ci
npm test               # unit + database + integration tests (PGlite; no cloud account)
npm run demo:reports   # prints the report queries on sample data
```

Everything above works offline after `npm ci`. No Supabase project is needed.

## 1b. Run the app offline (demo mode)

```bash
npm run models:download   # once: semantic search model (~31 MB, pinned + SHA-256 verified)
npm run demo              # http://localhost:3000 -> sign in as any demo user
```

Demo mode stores its database in `.demo-data/` (git-ignored) and seeds two sample clubs on first start. `npm run demo:reset` deletes it. It refuses to start when `DATABASE_URL` is set or `APP_ENV=production`, so demo sign-in can never reach a real database.

## 2. Create a Supabase project (development)

1. Create a project at supabase.com (or run `npx supabase start` locally).
2. **Apply the migrations**, either:
   - `npx supabase link --project-ref <ref>` then `npx supabase db push`, or
   - paste each file from `supabase/migrations/` into the SQL editor **in filename order**.
3. Copy `.env.example` to `.env.local` and fill in:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: Project Settings → API
   - `DATABASE_URL`: Project Settings → Database → connection string → **Transaction pooler** (port 6543)

## 3. Configure Supabase Auth

In the Supabase dashboard → Authentication:

1. **URL configuration**: Site URL `http://localhost:3000`. Redirect URLs: `http://localhost:3000/auth/callback`.
2. **Email provider**: enable "Confirm email".
3. **Email templates**: point the confirmation and recovery links at the confirm route:
   - Confirm signup: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`
   - Reset password: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`
4. **Google provider**: create an OAuth client in Google Cloud Console (type *Web application*), add the Supabase callback URL shown on the provider page as an authorized redirect URI, and paste the client id/secret into Supabase.
5. **JWT signing keys**: prefer asymmetric keys, so `getClaims()` verifies tokens locally without a network call.
6. Leave **anonymous sign-ins** disabled (the app treats them as signed out anyway).

## 4. Run

```bash
npm run dev
```

- http://localhost:3000: home page
- http://localhost:3000/api/health: `{"status":"ok","db":"ok"}` if `DATABASE_URL` works

## 5. Create the first platform admin and club

The sign-in screens arrive in Phase 2. Until then, create users in the dashboard (Authentication → Users → *Add user*, tick "auto confirm"). Then edit and run [`supabase/bootstrap/first_platform_admin_and_organization.sql`](../supabase/bootstrap/first_platform_admin_and_organization.sql) in the SQL editor.

That script is the **only** place the first club's identity is entered. The code contains no club names.

## Useful scripts

| Command | Does |
|---|---|
| `npm run dev` | Development server |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript (strict, `noUncheckedIndexedAccess`) |
| `npm test` / `npm run test:db` | All Vitest suites / database suite only |
| `npm run build && npx playwright test` | Production build + E2E |
| `npm run demo:reports` | Report queries on sample data |

## Troubleshooting

- **`Invalid server configuration: DATABASE_URL`**: the value is missing or not a `postgres://` URL. The error lists variable names only, never values.
- **`prepared statement … already exists`**: you are using the transaction pooler without `prepare: false`; use `src/server/db/client.ts` as provided.
- **Health check returns 503**: wrong `DATABASE_URL`, or the IP is not allowed. Check the server log line `health.db_unreachable`.
