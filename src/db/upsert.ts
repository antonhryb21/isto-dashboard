import { getTableColumns, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { db } from "@/db";

/**
 * Inserts many rows in chunks, updating existing ones (ON CONFLICT … DO UPDATE SET col = excluded.col).
 * One round trip per chunk instead of one per row: syncing a year of ads went from thousands of queries to a few.
 */
export async function upsertMany<T extends PgTable>(
  table: T,
  rows: T["$inferInsert"][],
  target: Parameters<ReturnType<ReturnType<typeof db.insert<T>>["values"]>["onConflictDoUpdate"]>[0]["target"],
  opts: { chunk?: number; update?: (keyof T["$inferInsert"])[]; key?: (r: T["$inferInsert"]) => string } = {},
) {
  if (opts.key) rows = [...new Map(rows.map((r) => [opts.key!(r), r])).values()];
  if (!rows.length) return 0;
  const cols = getTableColumns(table) as Record<string, { name: string }>;
  const keys = (opts.update as string[] | undefined) ?? Object.keys(rows[0]);
  const set: Record<string, SQL> = {};
  for (const k of keys) if (cols[k]) set[k] = sql.raw(`excluded."${cols[k].name}"`);
  const size = opts.chunk ?? 500;
  // Postgres rejects one statement that touches the same key twice: pass `key` to keep the last row per key.
  for (let i = 0; i < rows.length; i += size) {
    const part = rows.slice(i, i + size);
    await db
      .insert(table)
      .values(part as never)
      .onConflictDoUpdate({ target, set } as never);
  }
  return rows.length;
}
