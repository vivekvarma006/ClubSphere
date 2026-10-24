/**
 * Prints every query in supabase/queries/demo_reports.sql against a
 * throwaway in-memory database (PGlite) filled with sample data.
 * No Supabase project or Docker needed:
 *
 *   npm run demo:reports
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { freshWorld } from "../test/db/fixtures";
import { asUser } from "../test/db/harness";
import { seedReportData } from "../test/db/report-fixtures";

interface Block {
  name: string;
  as: "postgres" | "owner_a" | "owner_b";
  sql: string;
}

function parseBlocks(file: string): Block[] {
  return file
    .split(/^-- name: /m)
    .slice(1)
    .map((chunk) => {
      const [nameLine = "", asLine = "", ...rest] = chunk.split(/\r?\n/);
      const as = asLine.replace(/^-- as:\s*/, "").trim();
      if (as !== "postgres" && as !== "owner_a" && as !== "owner_b") throw new Error(`bad "as" in block ${nameLine}`);
      return { name: nameLine.trim(), as, sql: rest.join("\n").trim() };
    });
}

async function main() {
  const file = await readFile(path.join(import.meta.dirname, "..", "supabase", "queries", "demo_reports.sql"), "utf8");
  const blocks = parseBlocks(file);

  const { db, w } = await freshWorld();
  await seedReportData(db, w);
  await db.exec("set search_path = public"); // the queries use unqualified names, like the SQL editor

  for (const block of blocks) {
    console.log(`\n=== ${block.name}   [as ${block.as}]`);
    console.log(block.sql.replace(/;\s*$/, "").replace(/^/gm, "    "));
    const result =
      block.as === "postgres"
        ? await db.query(block.sql)
        : await asUser(db, block.as === "owner_a" ? w.ownerA : w.ownerB, async (tx) => {
            await tx.exec("set local search_path = public");
            return tx.query(block.sql);
          });
    console.table(result.rows);
  }
}

// Exit explicitly: the cached template databases from the test harness stay
// open and would otherwise keep the process alive.
main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
