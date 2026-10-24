import type { PGlite } from "@electric-sql/pglite";
import { getTableConfig, getViewConfig, PgTable, PgView } from "drizzle-orm/pg-core";
import { beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import { freshDb } from "./harness";

// The SQL migrations are the source of truth; src/server/db/schema.ts must
// describe exactly the same tables, views and columns.

let db: PGlite;
beforeAll(async () => {
  db = await freshDb();
});

async function dbColumns(relation: string): Promise<string[]> {
  const { rows } = await db.query<{ column_name: string }>(
    "select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 order by column_name",
    [relation],
  );
  return rows.map((r) => r.column_name);
}

const exported: unknown[] = Object.values(schema);
const tables = exported.filter((v): v is PgTable => v instanceof PgTable);
const views = exported.filter((v): v is PgView => v instanceof PgView);

describe("Drizzle schema matches the migrated database", () => {
  it("declares every public table", async () => {
    const { rows } = await db.query<{ name: string }>(
      "select table_name as name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1",
    );
    expect(tables.map((t) => getTableConfig(t).name).sort()).toEqual(rows.map((r) => r.name));
  });

  it.each(tables.map((t) => [getTableConfig(t).name, t] as const))("table %s has the same columns", async (name, table) => {
    const declared = getTableConfig(table).columns.map((c) => c.name).sort();
    expect(declared).toEqual(await dbColumns(name));
  });

  it.each(views.map((v) => [getViewConfig(v).name, v] as const))("view %s has the same columns", async (name, view) => {
    const declared = Object.values(getViewConfig(view).selectedFields)
      .map((field) => (field as { name: string }).name)
      .sort();
    expect(declared).toEqual(await dbColumns(name));
  });
});
