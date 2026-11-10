import "server-only";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { chunkDocument } from "@/server/search/chunking";
import { getEmbedder } from "@/server/search/embeddings";
import { DEMO_DOCUMENTS } from "./seed-documents";
import { ensureDemoShowcase } from "./showcase";

/**
 * Demo data: two fictional clubs with members, officers, applicants, events
 * (past, live and upcoming), QR check-ins and knowledge-base documents.
 * Everything goes through the same procedures the app uses, acting as the
 * relevant demo user, so the data obeys every rule the real system does.
 * Only timestamps of past activity are back-dated directly.
 */

type Tx = Transaction | PGlite;

async function asUser<T>(pg: PGlite, userId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return pg.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
    await tx.exec("set local role authenticated");
    return fn(tx);
  });
}

async function value<T>(tx: Tx, sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await tx.query<{ v: T }>(sql, params);
  const row = rows[0];
  if (!row) throw new Error(`seed query returned no row: ${sql.slice(0, 60)}`);
  return row.v;
}

const PEOPLE = {
  admin: ["Priya Raman", "admin"],
  arjun: ["Arjun Mehta", "arjun"],
  sneha: ["Sneha Iyer", "sneha"],
  kiran: ["Kiran Das", "kiran"],
  ananya: ["Ananya Rao", "ananya"],
  vikram: ["Vikram Singh", "vikram"],
  meera: ["Meera Nair", "meera"],
  rohan: ["Rohan Gupta", "rohan"],
  aditya: ["Aditya Kumar", "aditya"],
  divya: ["Divya Menon", "divya"],
  karthik: ["Karthik Reddy", "karthik"],
  neha: ["Neha Kapoor", "neha"],
  farhan: ["Farhan Ali", "farhan"],
  ishaan: ["Ishaan Joshi", "ishaan"],
  pooja: ["Pooja Desai", "pooja"],
  sanjay: ["Sanjay Pillai", "sanjay"],
  guest: ["Guest Student", "guest"],
} as const;
type Person = keyof typeof PEOPLE;

export async function seedDemoData(pg: PGlite): Promise<void> {
  const id = {} as Record<Person, string>;
  for (const [key, [name, handle]] of Object.entries(PEOPLE) as Array<[Person, readonly [string, string]]>) {
    id[key] = await value<string>(
      pg,
      `insert into auth.users (email, email_confirmed_at, raw_user_meta_data)
       values ($1, now(), jsonb_build_object('full_name', $2::text)) returning id as v`,
      [`${handle}@demo.test`, name],
    );
  }
  await pg.query("insert into public.platform_admins (user_id, note) values ($1, 'demo platform admin')", [id.admin]);

  // --- Organizations (created by the platform admin, like in production) ---
  const createOrg = (slug: string, name: string, owner: string) =>
    asUser(pg, id.admin, (tx) => value<string>(tx, "select private.create_organization($1, $2, $3) as v", [slug, name, owner]));
  const cyber = await createOrg("cyber-sec", "Cyber Security Club", id.arjun);
  const robotics = await createOrg("robotics", "Robotics Society", id.neha);

  for (const [owner, org] of [[id.arjun, cyber], [id.neha, robotics]]) {
    await asUser(pg, owner!, (tx) => tx.query(`update public.organizations set settings = '{"features":{"events":true,"volunteers":true,"inventory":true,"ctf":true,"certificates":true,"feedback":true,"analytics":true}}'::jsonb where id=$1`, [org]));
  }

  // Club-specific configuration, as each owner would set it.
  await asUser(pg, id.arjun, async (tx) => {
    await tx.query(
      `update public.organizations set branding = '{"shortName":"CSC","primaryColor":"#0f766e"}' where id = $1`,
      [cyber],
    );
    await tx.query(
      `insert into public.organization_profile_fields (organization_id, field_key, label, field_type, is_required, options, position) values
         ($1, 'year', 'Year of study', 'select', true, '["1st year","2nd year","3rd year","4th year"]', 1),
         ($1, 'experience', 'Security experience', 'select', true, '["Beginner","Intermediate","Advanced"]', 2),
         ($1, 'ctf_handle', 'CTF handle (optional)', 'text', false, null, 3)`,
      [cyber],
    );
  });
  await asUser(pg, id.neha, async (tx) => {
    await tx.query(
      `update public.organizations set branding = '{"shortName":"RS","primaryColor":"#7c3aed"}' where id = $1`,
      [robotics],
    );
    await tx.query(
      `insert into public.organization_profile_fields (organization_id, field_key, label, field_type, is_required, options, position) values
         ($1, 'year', 'Year of study', 'select', true, '["1st year","2nd year","3rd year","4th year"]', 1),
         ($1, 'branch', 'Branch / department', 'text', true, null, 2)`,
      [robotics],
    );
  });

  // --- Membership: request -> review, back-dated so reports have history ---
  const cyberAnswers = (year: string, experience: string) => ({ year, experience });
  const roboticsAnswers = (year: string) => ({ year, branch: "Electronics" });
  const roleId = (org: string, key: string) =>
    value<string>(pg, "select id as v from public.organization_roles where organization_id = $1 and role_key = $2", [org, key]);

  async function join(
    org: { id: string; slug: string },
    person: Person,
    answers: Record<string, string>,
    reviewer: string,
    opts: { daysAgo: number; hoursToReview: number; role?: string; outcome?: "approve" | "reject" | "pending" },
  ) {
    const requestId = await asUser(pg, id[person], (tx) =>
      value<string>(tx, "select private.request_membership($1, $2::jsonb) as v", [org.slug, JSON.stringify(answers)]),
    );
    const outcome = opts.outcome ?? "approve";
    if (outcome === "approve") {
      const membershipId = await asUser(pg, reviewer, (tx) =>
        value<string>(tx, "select private.approve_membership_request($1) as v", [requestId]),
      );
      if (opts.role) {
        const rid = await roleId(org.id, opts.role);
        await asUser(pg, reviewer, (tx) => tx.query("select private.assign_role($1, $2)", [membershipId, rid]));
      }
    } else if (outcome === "reject") {
      await asUser(pg, reviewer, (tx) =>
        tx.query("select private.reject_membership_request($1, 'Duplicate account: please use your college email')", [requestId]),
      );
    }
    await pg.query(
      `update public.membership_requests
          set applied_at = now() - make_interval(days => $2),
              reviewed_at = case when reviewed_at is null then null
                                 else now() - make_interval(days => $2) + make_interval(hours => $3) end
        where id = $1`,
      [requestId, opts.daysAgo, opts.hoursToReview],
    );
  }

  const C = { id: cyber, slug: "cyber-sec" };
  const R = { id: robotics, slug: "robotics" };
  await join(C, "sneha", cyberAnswers("3rd year", "Advanced"), id.arjun, { daysAgo: 60, hoursToReview: 2, role: "officer" });
  await join(C, "kiran", cyberAnswers("2nd year", "Intermediate"), id.arjun, { daysAgo: 45, hoursToReview: 20, role: "volunteer" });
  await join(C, "ananya", cyberAnswers("2nd year", "Intermediate"), id.sneha, { daysAgo: 40, hoursToReview: 5 });
  await join(C, "vikram", cyberAnswers("1st year", "Beginner"), id.sneha, { daysAgo: 33, hoursToReview: 30 });
  await join(C, "meera", cyberAnswers("3rd year", "Advanced"), id.sneha, { daysAgo: 25, hoursToReview: 3 });
  await join(C, "rohan", cyberAnswers("2nd year", "Beginner"), id.arjun, { daysAgo: 18, hoursToReview: 48 });
  await join(C, "karthik", cyberAnswers("1st year", "Beginner"), id.sneha, { daysAgo: 12, hoursToReview: 8, outcome: "reject" });
  await join(C, "aditya", cyberAnswers("1st year", "Beginner"), id.arjun, { daysAgo: 2, hoursToReview: 0, outcome: "pending" });
  await join(C, "divya", { ...cyberAnswers("2nd year", "Intermediate"), ctf_handle: "d1vya" }, id.arjun, { daysAgo: 1, hoursToReview: 0, outcome: "pending" });

  await join(R, "farhan", roboticsAnswers("3rd year"), id.neha, { daysAgo: 50, hoursToReview: 6, role: "officer" });
  await join(R, "ishaan", roboticsAnswers("2nd year"), id.farhan, { daysAgo: 30, hoursToReview: 12 });
  await join(R, "pooja", roboticsAnswers("1st year"), id.farhan, { daysAgo: 22, hoursToReview: 26 });
  await join(R, "rohan", roboticsAnswers("2nd year"), id.neha, { daysAgo: 15, hoursToReview: 4 });
  await join(R, "sanjay", roboticsAnswers("1st year"), id.neha, { daysAgo: 3, hoursToReview: 0, outcome: "pending" });

  // --- Events ---------------------------------------------------------------
  async function event(
    owner: string,
    org: string,
    e: { title: string; description: string; category: string; venue: string; startHours: number; durationHours: number; capacity: number | null; status: string },
  ) {
    return asUser(pg, owner, (tx) =>
      value<string>(
        tx,
        `insert into public.events (organization_id, title, description, category, venue, starts_at, ends_at, capacity, status)
         values ($1, $2, $3, $4, $5, now() + make_interval(hours => $6), now() + make_interval(hours => $6 + $7), $8, $9)
         returning id as v`,
        [org, e.title, e.description, e.category, e.venue, e.startHours, e.durationHours, e.capacity, e.status],
      ),
    );
  }

  const register = (person: Person, eventId: string) =>
    asUser(pg, id[person], (tx) => value<string>(tx, "select private.register_for_event($1) as v", [eventId]));
  const tokenOf = (registrationId: string) =>
    value<string>(pg, "select token as v from public.registration_credentials where registration_id = $1", [registrationId]);
  const scan = async (scanner: string, eventId: string, registrationId: string) => {
    // Read the token BEFORE opening the scanner's transaction: PGlite runs one
    // transaction at a time, so a query on `pg` inside it would wait forever.
    const token = await tokenOf(registrationId);
    return asUser(pg, scanner, (tx) => tx.query("select private.check_in($1, $2)", [eventId, token]));
  };

  /** Past events: register and check in while "live", then move the event into the past. */
  async function pastEvent(
    owner: string,
    org: string,
    e: Parameters<typeof event>[2],
    daysAgo: number,
    attendees: Person[],
    absentees: Person[],
    scanner: string,
  ) {
    const eventId = await event(owner, org, { ...e, startHours: -1, status: "published" });
    for (const p of attendees) await scan(scanner, eventId, await register(p, eventId));
    for (const p of absentees) await register(p, eventId);
    await pg.query(
      `update public.events set starts_at = now() - make_interval(days => $2), ends_at = now() - make_interval(days => $2) + make_interval(hours => $3), status = 'completed' where id = $1`,
      [eventId, daysAgo, e.durationHours],
    );
    await pg.query(
      `update public.event_registrations set registered_at = now() - make_interval(days => $2 + 3) where event_id = $1`,
      [eventId, daysAgo],
    );
    await pg.query(
      `update public.event_attendance set checked_in_at = now() - make_interval(days => $2) + interval '10 minutes' where event_id = $1`,
      [eventId, daysAgo],
    );
    return eventId;
  }

  const webWorkshop = await pastEvent(
    id.sneha,
    cyber,
    {
      title: "Web Exploitation Workshop",
      description: "Hands-on session on the OWASP Top 10: SQL injection, XSS and broken access control, with practice labs.",
      category: "workshop",
      venue: "Lab 3, CS Block",
      startHours: 0,
      durationHours: 3,
      capacity: 40,
      status: "completed",
    },
    14,
    ["ananya", "meera", "rohan", "kiran", "sneha"],
    ["vikram"],
    id.kiran,
  );

  const ctf = await event(id.sneha, cyber, {
    title: "CyberQuest CTF 2026",
    description: "Our annual jeopardy-style capture the flag: web, crypto, forensics and reversing challenges. Teams of up to three. Food is served at 1 pm.",
    category: "ctf",
    venue: "Seminar Hall",
    startHours: -1,
    durationHours: 7,
    capacity: 60,
    status: "published",
  });
  for (const p of ["ananya", "meera"] as const) await scan(id.kiran, ctf, await register(p, ctf));
  for (const p of ["vikram", "rohan", "sneha"] as const) await register(p, ctf);

  const talk = await event(id.sneha, cyber, {
    title: "Linux Privilege Escalation Talk",
    description: "From a low-privilege shell to root: SUID binaries, sudo misconfigurations, cron jobs and kernel exploits.",
    category: "talk",
    venue: "Room 204",
    startHours: 24 * 7,
    durationHours: 2,
    capacity: 30,
    status: "published",
  });
  await register("meera", talk);

  await event(id.arjun, cyber, {
    title: "Recruitment Drive 2027",
    description: "Stall at the club fair. Officers only until published.",
    category: "recruitment",
    venue: "Main Quad",
    startHours: 24 * 21,
    durationHours: 6,
    capacity: null,
    status: "draft",
  });

  await pastEvent(
    id.farhan,
    robotics,
    {
      title: "Arduino Bootcamp",
      description: "Two-hour introduction to microcontrollers: GPIO, PWM, motor drivers and reading sensors.",
      category: "workshop",
      venue: "Electronics Lab",
      startHours: 0,
      durationHours: 2,
      capacity: 25,
      status: "completed",
    },
    10,
    ["ishaan", "pooja"],
    ["rohan"],
    id.farhan,
  );

  const race = await event(id.farhan, robotics, {
    title: "Line Follower Race",
    description: "Build a robot that follows a black line on a white track. Fastest clean lap wins.",
    category: "competition",
    venue: "Indoor Stadium",
    startHours: 24 * 5,
    durationHours: 4,
    capacity: 20,
    status: "published",
  });
  await register("ishaan", race);

  // --- Knowledge base ---------------------------------------------------------
  const embedder = await getEmbedder();
  const eventIds: Record<string, string> = { webWorkshop, ctf, race };
  for (const doc of DEMO_DOCUMENTS) {
    const orgId = doc.club === "cyber-sec" ? cyber : robotics;
    const author = doc.club === "cyber-sec" ? id.sneha : id.farhan;
    const chunks = chunkDocument(doc.title, doc.body);
    const vectors = await embedder.embed(chunks);
    const payload = chunks.map((content, i) => ({ content, embedding: vectors[i] }));
    await asUser(pg, author, (tx) =>
      tx.query("select private.save_document($1, null, $2, $3, $4, $5, $6, $7, $8::jsonb)", [
        orgId,
        doc.title,
        doc.sourceType,
        doc.event ? eventIds[doc.event] ?? null : null,
        doc.body,
        doc.visibility ?? "members",
        embedder.model,
        JSON.stringify(payload),
      ]),
    );
  }
  await ensureDemoShowcase(pg);
}
