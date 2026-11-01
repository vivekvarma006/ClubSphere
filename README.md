# ClubSphere

A platform for running student clubs and organizations: membership, events, QR-based attendance and food distribution, volunteers, inventory, CTFs, certificates and analytics.

ClubSphere is **club-agnostic**. No club, university or role name is hardcoded. A new organization is a database row created with `private.create_organization(...)`, and PostgreSQL itself (row level security, composite foreign keys, security-definer procedures) keeps every organization's data isolated.

**Stack:** Next.js 16 (App Router, TypeScript) · Supabase Auth (Google + email/password) · PostgreSQL with RLS · Drizzle ORM (typed queries) · Zod · Vitest + PGlite · Playwright · GitHub Actions.

## Status

| Phase | Scope | State |
|---|---|---|
| 1. Foundation | Identity, organizations, per-org roles and permissions, membership requests and review, suspension, audit log, report views, auth plumbing, CI | ✅ Built and covered by automated tests |
| 2. Onboarding UI | Sign-in/up, organization selection, profile questions, request status, reviewer dashboard | ⏳ Next |
| 3. Modules | Events and registrations, QR check-in, food distribution, inventory, volunteers, CTF, certificates, pgvector semantic search, contribution analytics | 📐 Designed ([ER diagram](docs/DATABASE.md#3-er-diagram-full-system)) |

## Quick start (no cloud account needed)

```bash
npm ci
npm test               # unit + database + integration tests on in-memory Postgres (PGlite)
npm run demo:reports   # runs the report queries on sample data
```

To run the app against Supabase, follow [docs/SETUP.md](docs/SETUP.md).

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server on http://localhost:3000 |
| `npm run lint` · `npm run typecheck` | ESLint · strict TypeScript |
| `npm test` · `npm run test:db` | All Vitest suites · database suite only |
| `npm run build` · `npx playwright test` | Production build · end-to-end tests |
| `npm run demo:reports` | Demonstration report queries |

## Documentation

| Document | Contents |
|---|---|
| [Architecture](docs/ARCHITECTURE.md) | Layers, request lifecycle, directory structure, module conventions, decisions, open questions, performance targets |
| [Database](docs/DATABASE.md) | DB choice and justification, **ER diagrams**, relational schema, data dictionary, constraints, normalization, indexes, triggers, procedures, views |
| [Authorization](docs/AUTHORIZATION.md) | Permission model, escalation rules, authorization matrix |
| [Threat model](docs/THREAT_MODEL.md) | Threats to authentication, authorization and isolation; mitigations; residual risks |
| [Test strategy](docs/TEST_STRATEGY.md) | Test layers, fixtures, coverage of required scenarios |
| [Setup](docs/SETUP.md) · [Deployment](docs/DEPLOYMENT.md) | Local development; environments, release, rollback |
| [Viva guide](docs/VIVA_GUIDE.md) | Review demo script, novelty, 70-question bank with answers, practice queries |

## Repository layout

```
supabase/migrations/   SQL schema: the source of truth
supabase/queries/      demonstration queries (reports, DDL/DML)
supabase/bootstrap/    one-time SQL to create the first admin and club
src/server/            server-only: auth, authorization, DB access, services, validation
src/app/               routes: /auth/callback, /auth/confirm, /auth/error, /auth/update-password, /api/health
test/                  db (PGlite), integration, unit, concurrency (real Postgres), e2e
docs/                  documentation
```

## Security notes

- The Supabase **service-role key is not used** by the application.
- All server database work runs as the `authenticated` role with the verified user's id, so RLS applies.
- Secrets live in environment variables only; see [.env.example](.env.example).
