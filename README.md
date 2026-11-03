# ClubSphere

A platform for running student clubs and organizations: membership, events, QR-based attendance and food distribution, volunteers, inventory, CTFs, certificates and analytics.

ClubSphere is **club-agnostic**. No club, university or role name is hardcoded. A new organization is a database row created with `private.create_organization(...)`, and PostgreSQL itself (row level security, composite foreign keys, security-definer procedures) keeps every organization's data isolated.

**Stack:** Next.js 16 (App Router, TypeScript) · Supabase Auth (Google + email/password) · PostgreSQL with RLS · Drizzle ORM (typed queries) · Zod · Vitest + PGlite · Playwright · GitHub Actions.

## Status

| Phase | Scope | State |
|---|---|---|
| 1. Foundation | Identity, organizations, per-org roles and permissions, membership requests and review, suspension, audit log, report views, auth plumbing, CI | ✅ Built and covered by automated tests |
| **Review-1 prototype** (tag `review-1-prototype`) | Offline demo mode, join flow, review queue, events with capacity, private QR codes, exactly-once QR check-in scanner, pgvector + full-text hybrid search, reports UI | ✅ Built, tested, demo walkthrough in [docs/PROTOTYPE_DEMO.md](docs/PROTOTYPE_DEMO.md) |
| Remaining | Supabase sign-in screens, member management UI, food distribution, inventory, volunteers, CTF, certificates, feedback, contribution analytics, settings/admin | 📐 Planned in [docs/ROADMAP.md](docs/ROADMAP.md) |

## Quick start (no cloud account needed)

```bash
npm ci
npm run demo           # the web app with sample data on http://localhost:3000 (sign in as a demo user)
npm test               # unit + database + integration tests on in-memory Postgres (PGlite)
npm run demo:reports   # runs the report queries on sample data in the terminal
```

Demo mode runs the same SQL and application code on a local PGlite database with "sign in as" demo accounts. It refuses to start if a real `DATABASE_URL` is set.

To run the app against Supabase, follow [docs/SETUP.md](docs/SETUP.md).

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server on http://localhost:3000 |
| `npm run lint` · `npm run typecheck` | ESLint · strict TypeScript |
| `npm test` · `npm run test:db` | All Vitest suites · database suite only |
| `npm run build` · `npx playwright test` | Production build · end-to-end tests |
| `npm run demo` · `npm run demo:start` | Offline demo (dev server · production server after `npm run build`) |
| `npm run demo:reset` | Delete the local demo database (re-seeded on next start) |
| `npm run models:download` | Fetch the semantic-search embedding model (pinned, SHA-256 verified) |
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
| [Prototype demo](docs/PROTOTYPE_DEMO.md) · [Roadmap](docs/ROADMAP.md) | Review-1 walkthrough · what remains and how to resume |
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
