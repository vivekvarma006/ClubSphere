import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { freshWorld, type World } from "./fixtures";
import { asUser, pgError, scalar } from "./harness";

// Deterministic 256-d unit vectors stand in for a model: documents about the
// same "topic" share a basis direction, so similarity is predictable.
function unit(topic: number, wobble = 0): string {
  const v = new Array<number>(256).fill(0);
  v[topic] = 1;
  v[(topic + 1) % 256] = wobble;
  const norm = Math.hypot(1, wobble);
  return `[${v.map((x) => (x / norm).toFixed(6)).join(",")}]`;
}

const MODEL = "test-model";
let db: PGlite;
let w: World;

beforeEach(async () => {
  ({ db, w } = await freshWorld());
});

async function save(
  actor: string,
  orgId: string,
  title: string,
  chunks: Array<{ content: string; topic: number }>,
  visibility = "members",
): Promise<string> {
  const payload = JSON.stringify(chunks.map((c) => ({ content: c.content, embedding: JSON.parse(unit(c.topic)) })));
  return asUser(db, actor, (tx) =>
    scalar<string>(
      tx,
      "select private.save_document($1, null, $2, 'guide', null, $3, $4, $5, $6::jsonb) as v",
      [orgId, title, chunks.map((c) => c.content).join("\n\n"), visibility, MODEL, payload],
    ),
  );
}

async function search(actor: string, orgId: string, topic: number, text: string) {
  return (
    await asUser(db, actor, (tx) =>
      tx.query<{ title: string; semantic_similarity: number | null; keyword_rank: number | null }>(
        "select title, semantic_similarity, keyword_rank from private.search_documents($1, $2::extensions.vector, $3, $4, 10)",
        [orgId, unit(topic, 0.2), text, MODEL],
      ),
    )
  ).rows;
}

describe("saving documents", () => {
  it("stores a document and its embedded chunks atomically", async () => {
    const id = await save(w.officerA, w.orgA.id, "Web security basics", [
      { content: "Cross-site scripting steals cookies", topic: 1 },
      { content: "Escape output to prevent it", topic: 1 },
    ]);
    expect(await scalar<number>(db, "select count(*)::int as v from public.document_chunks where document_id = $1", [id])).toBe(2);
  });

  it("is limited to document managers of that organization", async () => {
    expect((await pgError(save(w.memberA, w.orgA.id, "Nope", [{ content: "x", topic: 1 }]))).code).toBe("CS404");
    expect((await pgError(save(w.officerA, w.orgB.id, "Nope", [{ content: "x", topic: 1 }]))).code).toBe("CS404");
  });

  it("rejects vectors of the wrong dimension", async () => {
    const err = await pgError(
      asUser(db, w.officerA, (tx) =>
        tx.query("select private.save_document($1, null, 'Bad', 'guide', null, 'x', 'members', 'm', $2::jsonb)", [
          w.orgA.id,
          JSON.stringify([{ content: "x", embedding: [1, 2, 3] }]),
        ]),
      ),
    );
    expect(err.message).toMatch(/dimensions/);
  });

  it("replaces chunks on update and removes them on delete", async () => {
    const id = await save(w.officerA, w.orgA.id, "Draft", [{ content: "one", topic: 1 }, { content: "two", topic: 1 }]);
    await asUser(db, w.officerA, (tx) =>
      tx.query("select private.save_document($1, $2, 'Final', 'guide', null, 'only', 'members', $3, $4::jsonb)", [
        w.orgA.id,
        id,
        MODEL,
        JSON.stringify([{ content: "only", embedding: JSON.parse(unit(2)) }]),
      ]),
    );
    expect(await scalar<number>(db, "select count(*)::int as v from public.document_chunks where document_id = $1", [id])).toBe(1);

    await asUser(db, w.officerA, (tx) => tx.query("select private.delete_document($1)", [id]));
    expect(await scalar<number>(db, "select count(*)::int as v from public.document_chunks")).toBe(0);
  });
});

describe("hybrid search", () => {
  beforeEach(async () => {
    await save(w.officerA, w.orgA.id, "XSS write-up", [{ content: "Injected script reads document.cookie", topic: 10 }]);
    await save(w.officerA, w.orgA.id, "Line follower guide", [{ content: "Infrared sensors steer the robot", topic: 20 }]);
    await save(w.officerA, w.orgA.id, "Officer notes", [{ content: "Budget for the cookie stall", topic: 30 }], "officers");
    await save(w.officerB, w.orgB.id, "Beta secret", [{ content: "Cookie recipe", topic: 10 }]);
  });

  it("ranks by meaning: a query near the XSS vector finds the write-up without shared words", async () => {
    const rows = await search(w.memberA, w.orgA.id, 10, "stealing sessions");
    expect(rows[0]).toMatchObject({ title: "XSS write-up", keyword_rank: null });
    expect(rows[0]?.semantic_similarity).toBeGreaterThan(0.9);
  });

  it("also finds exact words through full-text search", async () => {
    const rows = await search(w.memberA, w.orgA.id, 99, "infrared sensors");
    expect(rows.map((r) => r.title)).toEqual(["Line follower guide"]);
    expect(rows[0]?.keyword_rank).toBeGreaterThan(0);
  });

  it("hides officer-only documents from members but not from officers", async () => {
    expect((await search(w.memberA, w.orgA.id, 30, "cookie")).map((r) => r.title)).not.toContain("Officer notes");
    expect((await search(w.officerA, w.orgA.id, 30, "cookie")).map((r) => r.title)).toContain("Officer notes");
  });

  it("never returns another organization's documents, even when asked for them by id", async () => {
    expect(await search(w.memberA, w.orgB.id, 10, "cookie")).toEqual([]);
    expect((await search(w.memberA, w.orgA.id, 10, "cookie")).map((r) => r.title)).not.toContain("Beta secret");
  });

  it("is not available to people outside the club", async () => {
    expect(await search(w.applicant, w.orgA.id, 10, "cookie")).toEqual([]);
  });
});
