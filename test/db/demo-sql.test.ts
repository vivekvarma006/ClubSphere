import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { freshWorld } from "./fixtures";
import { asUser, scalar } from "./harness";
import { seedReportData } from "./report-fixtures";

const QUERIES = path.resolve(import.meta.dirname, "../../supabase/queries");

// The demo SQL files are shown live in reviews; make sure they keep working.
describe("demonstration SQL", () => {
  it("ddl_dml_demo.sql runs end to end and leaves no trace", async () => {
    const { db } = await freshWorld();
    await db.exec(await readFile(path.join(QUERIES, "ddl_dml_demo.sql"), "utf8"));
    expect(await scalar<string | null>(db, "select to_regclass('public.demo_events')::text as v")).toBeNull();
  });

  it("every block in demo_reports.sql executes and returns rows", async () => {
    const { db, w } = await freshWorld();
    await seedReportData(db, w);
    const file = await readFile(path.join(QUERIES, "demo_reports.sql"), "utf8");
    const blocks = file.split(/^-- name: /m).slice(1);
    expect(blocks.length).toBeGreaterThanOrEqual(10);

    for (const block of blocks) {
      const [name = "", asLine = "", ...rest] = block.split(/\r?\n/);
      const sql = rest.join("\n");
      const as = asLine.replace(/^-- as:\s*/, "").trim();
      const run = async () => {
        if (as === "postgres") {
          await db.exec("set search_path = public");
          return db.query(sql);
        }
        return asUser(db, as === "owner_a" ? w.ownerA : w.ownerB, async (tx) => {
          await tx.exec("set local search_path = public");
          return tx.query(sql);
        });
      };
      const result = await run();
      expect(result.rows.length, name).toBeGreaterThan(0);
    }
  });
});
