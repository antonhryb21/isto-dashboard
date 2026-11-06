import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { pg?: ReturnType<typeof postgres> };

function client() {
  if (!globalForDb.pg) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    // Serverless (Vercel): keep few connections; Neon's pooled URL handles fan-out.
    globalForDb.pg = postgres(url, { max: 5, prepare: false, idle_timeout: 20 });
  }
  return globalForDb.pg;
}

export const db = drizzle(client(), { schema });
export { schema };
