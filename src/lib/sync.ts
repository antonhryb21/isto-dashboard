import "server-only";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { regions, syncRuns } from "@/db/schema";
import { DEFAULT_LEAD_SPREADSHEETS, DEFAULT_REGIONS } from "@/lib/config";
import { syncAdStructure, syncInsights } from "@/lib/meta/ads";
import { syncFacebook, syncInstagram } from "@/lib/meta/social";
import { discoverSources, importAllSources } from "@/lib/sheets/sync";

export type SyncKind = "quick" | "daily" | "backfill";

const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

/** Idempotent first-run setup: regions and the known lead spreadsheets. */
export async function ensureSeed() {
  for (const r of DEFAULT_REGIONS) await db.insert(regions).values(r).onConflictDoNothing();
  for (const s of DEFAULT_LEAD_SPREADSHEETS) {
    try {
      await discoverSources(s.spreadsheetId, s.regionCode, s.historySheetName);
    } catch {
      /* the service account may not have access yet; reported by the import step */
    }
  }
}

/**
 * quick    — last 3 days of ad metrics, lead sheets, recent Instagram posts (every 10–15 min / on demand)
 * daily    — ad structure + creatives, 30 days of metrics, IG + FB posts with insights, lead sheets
 * backfill — up to `months` of history, in 30-day chunks
 */
export async function runSync(kind: SyncKind, opts: { months?: number } = {}) {
  // Don't stack runs: skip if the same kind started in the last 4 minutes and hasn't finished.
  const [running] = await db
    .select()
    .from(syncRuns)
    .where(and(eq(syncRuns.kind, kind), isNull(syncRuns.finishedAt), gt(syncRuns.startedAt, new Date(Date.now() - 4 * 60_000))))
    .limit(1);
  if (running) return { skipped: true };

  const [run] = await db.insert(syncRuns).values({ kind }).returning();
  const report: Record<string, unknown> = {};
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      report[name] = await fn();
    } catch (e) {
      report[name] = { error: e instanceof Error ? e.message : String(e) };
    }
  };

  await ensureSeed();

  if (kind === "quick") {
    await step("insights", () => syncInsights(day(2), day(0)));
    await step("leads", () => importAllSources());
    await step("instagram", () => syncInstagram(7));
  }
  if (kind === "daily") {
    await step("structure", () => syncAdStructure());
    await step("insights", () => syncInsights(day(30), day(0)));
    await step("instagram", () => syncInstagram(30));
    await step("facebook", () => syncFacebook(30));
    await step("leads", () => importAllSources());
  }
  if (kind === "backfill") {
    const months = Math.min(opts.months ?? 12, 36);
    await step("structure", () => syncAdStructure());
    const chunks: unknown[] = [];
    for (let m = 0; m < months; m++) {
      const until = day(m * 30);
      const since = day(m * 30 + 29);
      try {
        chunks.push(await syncInsights(since, until));
      } catch (e) {
        chunks.push({ since, error: e instanceof Error ? e.message : String(e) });
      }
    }
    report.insights = chunks;
    await step("instagram", () => syncInstagram(120));
    await step("facebook", () => syncFacebook(120, 1000));
    await step("leads", () => importAllSources());
  }

  const failed = Object.values(report).some((v) => typeof v === "object" && v !== null && "error" in v);
  await db
    .update(syncRuns)
    .set({ finishedAt: new Date(), ok: !failed, message: JSON.stringify(report).slice(0, 4000) })
    .where(eq(syncRuns.id, run.id));
  return report;
}

export async function lastSync(kind?: SyncKind) {
  const q = db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(1);
  const [r] = kind ? await db.select().from(syncRuns).where(eq(syncRuns.kind, kind)).orderBy(desc(syncRuns.startedAt)).limit(1) : await q;
  return r ?? null;
}
