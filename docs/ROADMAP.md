# Roadmap: from the Review-1 prototype to the finished product

Checkpoint: tag **`review-1-prototype`** (see [PROTOTYPE_DEMO.md](PROTOTYPE_DEMO.md)). The numbered list below records the requested product work, in its intended order. Each module follows the conventions in [ARCHITECTURE.md](ARCHITECTURE.md#conventions-every-new-module-must-follow): organization-scoped tables with composite foreign keys, RLS plus explicit grants, permissions registered with `private.register_permission(...)`, writes through `private.*` procedures, audit triggers, and forbidden-path tests.

## Done in the prototype

| Area | Where |
|---|---|
| Foundation: identity, organizations, per-club roles and permissions, membership requests, suspension, audit log, report views | migrations `0100`–`0900`, `20261102000100` |
| Role templates (default roles as data; `owner`, `officer`, `volunteer`, `member`) | `20261103001000_role_templates.sql` |
| Events, registrations with capacity, private QR credentials, exactly-once attendance, attendance report | `20261103001100_events_and_attendance.sql`, `src/server/services/events.ts` |
| Knowledge base with pgvector + full-text hybrid search; static embedding model | `20261103001200_knowledge_base.sql`, `src/server/search/*`, `src/server/services/knowledge-base.ts` |
| Offline demo mode (local PGlite database, demo sign-in, seed data) | `src/server/demo/*`, `src/server/auth/demo-session.ts`, `scripts/demo.mjs` |
| Web UI: login (demo), dashboard, join flow, club overview, review queue, events (list, create, detail, QR), scanner, knowledge base, reports | `src/app/**` |

## Implementation checkpoint (2026-11-03)

Items 1–9 are implemented. Item 10 includes a nonce CSP, durable request budgets, Chromium demo flows in CI, updated authorization/schema documentation and development rollbacks. Optional modules default off for existing clubs and can be enabled in Settings; new demo clubs enable them. The package is version `1.0.0`. Local verification: 299 Vitest cases, seven Chromium workflows and nine HTTP smoke checks pass, along with lint, typecheck and production build.

Verification evidence is recorded in [TEST_STRATEGY.md](TEST_STRATEGY.md). Production Supabase/provider checks and real multi-connection concurrency with pgvector remain deployment checks. Release marker: `v1.0` on the reviewed implementation commit, separate from production deployment.

## Requested work, in order

1. **Supabase sign-in screens** (email + password sign-up and login, Google OAuth button, forgot-password), replacing the prototype notice on `/login` in Supabase mode. The callback, confirm and update-password routes already exist.
2. **Member management UI**: member list (`member.read`), suspend/reinstate, assign/revoke roles. Services and procedures already exist (`suspendMember`, `reinstateMember`, `private.assign_role`).
3. **Food distribution + inventory**: `inventory_items` (quantity `CHECK >= 0`), `stock_movements` with an AFTER INSERT trigger maintaining quantity, `meal_slots` per event, `food_claims` with PK `(registration_id, meal_slot_id)`; procedure `claim_meal(event, slot, token)` that requires check-in, inserts the claim and a `-1` stock movement in one transaction. Permissions `food.distribute` (officer, volunteer) and `inventory.manage` (officer). Add a meal mode to the scanner.
4. **Volunteer tasks**: `volunteer_tasks`, `task_assignments`; permission `task.manage`; members see and complete their tasks.
5. **CTF**: `ctf_challenges` (flag stored as SHA-256, column not granted to API roles), `ctf_attempts`, `ctf_solves`; procedure `submit_flag`; scoreboard view with `RANK()`; write-ups saved to the knowledge base by solvers.
6. **Certificates**: bulk issue for attendees (`INSERT … SELECT … ON CONFLICT DO NOTHING`), random verification codes, public `/verify/[code]` page via an `anon`-executable function, printable page.
7. **Feedback**: rating + comment per attended event; comments indexed into the knowledge base.
8. **Contribution analytics**: per-member view combining attendance, tasks, CTF points and certificates, ranked with window functions; leaderboard page.
9. **Audit-log viewer** (`audit.read`), **club settings** (branding, onboarding policy, email domains, profile questions, custom roles) and **platform admin** pages (create/suspend clubs).
10. **Hardening**: Content-Security-Policy, rate limiting on requests/scans, Playwright browser tests for the demo flows, docs and ER diagram updated to the final schema, final tag `v1.0`.

## How to resume

```bash
npm ci
npm test
npm run build
npx playwright install chromium
npm run test:e2e:demo         # fresh isolated local database, hash embeddings
npm run models:download       # optional: semantic model for interactive demo
npm run demo
```

Remaining deployment verification: live Supabase email sign-up/confirmation, Google OAuth, recovery and account linking need staging configuration; real concurrency tests need `TEST_DATABASE_URL` and Postgres with pgvector. No cloud database or deployment is modified by the local checks. The implementation and local verification do not constitute a production deployment.
