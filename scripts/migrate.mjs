// Applies pending SQL migrations from ./drizzle before the build.
// Skips quietly when no database is configured (e.g. a local build without .env).
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
  console.log("[migrate] DATABASE_URL not set, skipping migrations");
  process.exit(0);
}

const sql = postgres(url, { max: 1, prepare: false });
try {
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  console.log("[migrate] database is up to date");
} catch (e) {
  console.error("[migrate] failed:", e);
  process.exitCode = 1;
} finally {
  await sql.end();
}
