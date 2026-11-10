# Review 1: prototype demo

This is the checkpoint tagged `review-1-prototype`. It runs entirely on the presenting laptop: no Supabase account, Docker or Wi-Fi needed after the first install.

## Before the review (once, with internet)

```bash
git clone https://github.com/vivekvarma006/ClubSphere
cd ClubSphere
git checkout review-1-prototype      # the prototype checkpoint (omit to use the latest main)
npm ci
npm run models:download              # semantic search model, ~31 MB, verified by SHA-256
npm run build
```

## On the day

```bash
npm run demo:start                   # production server in demo mode on http://localhost:3000
```

(`npm run demo` starts the development server instead. `npm run demo:reset` restores the original sample data.)

The first page load creates and seeds the local database (a few seconds). Sign in by clicking a demo person on `/login`.

## What to show, mapped to the review checklist

| Checklist item | Where | What to say |
|---|---|---|
| **1. ≥ 5 tables in the ER diagram** | [DATABASE.md](DATABASE.md) (GitHub renders the diagrams) | 20 tables built: 12 foundation + 2 role-template tables + events, registrations, QR credentials, attendance + documents and vector chunks. M:N relationships resolved through memberships, membership_roles, role_permissions. |
| **2. RDBMS + vector (original prototype)** | Club → **Knowledge base** | PostgreSQL for transactional data; **pgvector** (requirements Option 2: SQL + vector database) for semantic search over write-ups and event documents. Search *"stealing session cookies with javascript"*: the XSS write-up ranks first by meaning (≈60 % match) although full-text search finds no matching words ("exact words: no"). |
| **3. Reports** | Club → **Reports** (as an officer) and `npm run demo:reports` | "Average review time per club" is the analogue of "average salary per department". Event attendance rate per event. Every table comes from a SQL view; the same view shows a different club only that club's numbers (RLS). |
| **4. Novelty** | Flows below | Database-enforced multi-club isolation, exactly-once QR check-in, privilege can only flow downwards, hybrid vector + keyword search, tamper-proof audit trail. |

## Suggested 8-minute walkthrough

1. **Sneha Iyer (officer, Cyber Security Club)**
   - *Overview*: "What you can do here" lists her permissions in this club only.
   - *Review requests*: approve **Aditya Kumar** → the queue updates; mention the audit trail and the row lock that stops a double approval.
   - *Events → CyberQuest CTF 2026*: her QR code, the registrant list (2 checked in), manager controls.
   - *Scan QR*: start the camera and show a phone with another person's QR (or paste a code from "Code as text"). First scan: green **Checked in**. Same code again: **Already checked in earlier: not counted twice**.
   - *Knowledge base*: run the search example above.
   - *Reports*: the numbers already include the approval and check-in you just did.
2. **Vikram Singh (plain member)**: only Overview, Events, Knowledge base tabs. Typing `/o/cyber-sec/reports` gives 404. Register for *Linux Privilege Escalation Talk* → his QR appears. Open *Robotics Society* → "pages are for members".
3. **Rohan Gupta**: member of both clubs. His dashboard lists both; each club shows only its own data.
4. **Guest Student**: *Join a club* → Cyber Security Club → answers the club-specific questions → request appears in Sneha's queue.

## Showing it from a phone (real QR scanning)

Camera access needs `https` or `localhost`. Easiest: show the member's QR on the phone by signing in on the laptop in a second browser profile, or display the QR on the laptop and scan it with the phone camera through a tunnel. If you have no camera setup, the paste box performs the same server-side check.

## What this prototype deliberately does not include yet

See [ROADMAP.md](ROADMAP.md): Supabase sign-in screens, member management UI, food distribution and inventory, volunteer tasks, CTF scoring, certificates, feedback forms, contribution analytics, audit-log viewer, settings and admin screens.

The current SQL + NoSQL implementation additionally uses Redis for contribution-report snapshots. Follow [DATABASE_WALKTHROUGH.md](DATABASE_WALKTHROUGH.md) to run both stores.


## Current demo: activity, waitlists and visual reports

The current working version also includes [ready-to-try sample accounts](VISUAL_TOUR.md#ready-to-try-demo-accounts) for the new workflows. Ananya starts with a task, certificate and waitlist position #1; Vikram holds the one-seat event; Rohan has a robotics task and an already-promoted QR. Sneha can open visual Reports. These are additive, versioned demo fixtures: existing local data is upgraded without resetting it, and restarts do not undo actions taken during a presentation.
