import "server-only";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { competitors, regions, syncRuns } from "@/db/schema";
import { DEFAULT_COMPETITORS, DEFAULT_LEAD_SPREADSHEETS, DEFAULT_REGIONS } from "@/lib/config";
import { syncCompetitors } from "@/lib/meta/competitors";
import { syncAdStructure, syncInsights } from "@/lib/meta/ads";
import { syncFacebook, syncInstagram } from "@/lib/meta/social";
import { discoverSources, importAllSources } from "@/lib/sheets/sync";
import { syncMetaLeads } from "@/lib/meta/leadgen";

/** Live Google Sheets sync is optional: on only when a service account is configured. */
export const sheetsEnabled = () => !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;

export type SyncKind = "quick" | "daily" | "backfill";

const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

/** Idempotent first-run setup: regions and the known lead spreadsheets. */
export async function ensureSeed() {
  for (const r of DEFAULT_REGIONS) await db.insert(regions).values(r).onConflictDoNothing();
  for (const c of DEFAULT_COMPETITORS) await db.insert(competitors).values(c).onConflictDoNothing();
  if (!sheetsEnabled()) return;
  for (const s of DEFAULT_LEAD_SPREADSHEETS) {
    try {
      await discoverSources(s.spreadsheetId, s.regionCode, s.historySheetName);
    } catch {
      /* the service account may not have access yet; reported by the import step */
    }
  }
}

/**
 * quick    — last 3 days of ad metrics, recent Instagram posts (on page view when stale / on demand)
 * daily    — ad structure + creatives, 30 days of metrics, IG + FB posts with insights,
 *            leads from Meta forms for the last 3 days (catches anything the webhook missed)
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
    if (sheetsEnabled()) await step("sheets", () => importAllSources());
    await step("instagram", () => syncInstagram(7));
  }
  if (kind === "daily") {
    await step("structure", () => syncAdStructure());
    await step("insights", () => syncInsights(day(30), day(0)));
    await step("instagram", () => syncInstagram(30));
    await step("facebook", () => syncFacebook(30));
    await step("metaLeads", () => syncMetaLeads(3));
    await step("competitors", () => syncCompetitors(2));
    if (sheetsEnabled()) await step("sheets", () => importAllSources());
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
    await step("metaLeads", () => syncMetaLeads(90));
    await step("competitors", () => syncCompetitors(10));
    if (sheetsEnabled()) await step("sheets", () => importAllSources());
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

/** True when the last quick sync is missing or older than `minutes`. */
export function isStale(run: { startedAt: Date } | null, minutes = 10) {
  return !run || Date.now() - run.startedAt.getTime() > minutes * 60_000;
}
