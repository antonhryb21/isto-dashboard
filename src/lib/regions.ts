import "server-only";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { regions } from "@/db/schema";

export type Region = typeof regions.$inferSelect;

export async function listRegions(): Promise<Region[]> {
  return db.select().from(regions).orderBy(asc(regions.sortOrder), asc(regions.name));
}

/** Pick the region whose keyword appears in any of the given names (campaign, ad set, form, sheet). */
export function detectRegion(all: Region[], ...names: (string | null | undefined)[]): string | null {
  const hay = ` ${names.filter(Boolean).join(" ").toLowerCase()} `;
  for (const r of all) {
    for (const k of r.keywords) {
      const kw = k.toLowerCase();
      // Short keywords like "eu" must stand alone, not match inside "europe" or "museum".
      if (kw.length <= 3) {
        if (new RegExp(`(^|[^\\p{L}])${escape(kw.trim())}([^\\p{L}]|$)`, "u").test(hay)) return r.code;
      } else if (hay.includes(kw)) return r.code;
    }
  }
  return null;
}

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
