import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type DB = PostgresJsDatabase<typeof schema>;
const globalForDb = globalThis as unknown as { db?: DB };

function instance(): DB {
  if (!globalForDb.db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    // Serverless (Vercel): keep few connections; Neon's pooled URL handles fan-out.
    const client = postgres(url, { max: Number(process.env.DB_POOL_MAX ?? 5), prepare: false, idle_timeout: 20 });
    globalForDb.db = drizzle(client, { schema });
  }
  return globalForDb.db;
}

/** Connects on first use, so importing this module during the build needs no database. */
export const db = new Proxy({} as DB, {
  get(_, prop) {
    const real = instance();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export { schema };
