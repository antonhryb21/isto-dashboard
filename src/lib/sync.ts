import "server-only";
import { daysAgo } from "@/lib/dates";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { adInsightsDaily, competitors, regions, syncRuns } from "@/db/schema";
import { DEFAULT_COMPETITORS, DEFAULT_LEAD_SPREADSHEETS, DEFAULT_REGIONS } from "@/lib/config";
import { syncCompetitors } from "@/lib/meta/competitors";
import { syncAdStructure, syncInsights } from "@/lib/meta/ads";
import { syncFacebook, syncInstagram } from "@/lib/meta/social";
import { discoverSources, importAllSources } from "@/lib/sheets/sync";
import { syncMetaLeads } from "@/lib/meta/leadgen";

/** Live Google Sheets sync is optional: on only when a service account is configured. */
export const sheetsEnabled = () => !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;

export type SyncKind = "quick" | "daily" | "backfill";

const day = (offset: number) => daysAgo(offset);

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
  // Vercel stops a function after 300 s; leave room to record the result instead of being cut off mid-way.
  const started = Date.now();
  const BUDGET_MS = 240_000;
  const step = async (name: string, fn: () => Promise<unknown>) => {
    if (Date.now() - started > BUDGET_MS) {
      report[name] = { skipped: "не вистачило часу — підтягнеться наступним оновленням" };
      return;
    }
    const t0 = Date.now();
    try {
      const r = await fn();
      report[name] = r && typeof r === "object" ? { ...(r as object), seconds: Math.round((Date.now() - t0) / 1000) } : r;
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
    // Most important first: if time runs out, the tail waits for the next run.
    await step("insights", () => syncInsights(day(30), day(0)));
    await step("metaLeads", () => syncMetaLeads(3));
    await step("structure", () => syncAdStructure());
    await step("instagram", () => syncInstagram(30));
    await step("facebook", () => syncFacebook(30));
    await step("competitors", () => syncCompetitors(2));
    if (sheetsEnabled()) await step("sheets", () => importAllSources());
  }
  if (kind === "backfill") {
    const months = Math.min(opts.months ?? 12, 36);
    // Resumable: continue below the oldest day already loaded, month by month, until the time budget runs out.
    const [oldest] = await db.select({ d: sql<string | null>`min(${adInsightsDaily.date})` }).from(adInsightsDaily);
    const oldestDays = oldest?.d ? Math.floor((Date.now() - Date.parse(String(oldest.d))) / 86_400_000) : 0;
    let m = Math.max(0, Math.floor(oldestDays / 30) - 1);
    const errors: unknown[] = [];
    let loadedTo: string | null = null;
    for (; m < months && Date.now() - started < 180_000; m++) {
      const until = day(m * 30);
      const since = day(m * 30 + 29);
      try {
        await syncInsights(since, until);
        loadedTo = since;
      } catch (e) {
        errors.push({ since, error: e instanceof Error ? e.message : String(e) });
      }
    }
    report.insights = {
      ...(errors.length ? { error: JSON.stringify(errors).slice(0, 500) } : {}),
      loadedTo,
      done: m >= months,
      ...(m < months ? { note: `історію завантажено до ${loadedTo ?? "—"}; натисніть «Завантажити історію» ще раз, щоб продовжити` } : {}),
    };
    await step("structure", () => syncAdStructure({ all: true }));
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

/** Last finished run without errors: the moment the numbers on screen are current as of. */
export async function lastOkSync() {
  const [r] = await db.select().from(syncRuns).where(eq(syncRuns.ok, true)).orderBy(desc(syncRuns.startedAt)).limit(1);
  return r ?? null;
}

const STEP_LABEL: Record<string, string> = {
  structure: "Кампанії й креативи",
  insights: "Статистика реклами",
  instagram: "Instagram",
  facebook: "Facebook",
  metaLeads: "Ліди з Meta",
  competitors: "Конкуренти",
  sheets: "Google Таблиці",
};

/** Turns a raw API error into a sentence the team can act on. */
export function explainError(message: string) {
  if (/META_SYSTEM_USER_TOKEN is not set/.test(message)) return "немає токена Meta — додайте META_SYSTEM_USER_TOKEN у Vercel і зробіть Redeploy";
  if (/session has expired|invalid oauth|error validating access token|code 190/i.test(message)) return "токен Meta недійсний або прострочений — згенеруйте новий";
  if (/permission|not authorized|requires.*(permission|scope)/i.test(message)) return `токену Meta бракує доступу: ${message}`;
  if (/rate limit|too many calls|request limit/i.test(message)) return "Meta тимчасово обмежила кількість запитів — спробує ще раз пізніше";
  return message;
}

/** Steps of a run that failed, in plain words. */
export function runProblems(run: { ok: boolean | null; message: string | null } | null): { step: string; error: string }[] {
  if (!run || run.ok !== false || !run.message) return [];
  let report: Record<string, unknown>;
  try {
    report = JSON.parse(run.message);
  } catch {
    return [{ step: "Оновлення", error: run.message }];
  }
  const out: { step: string; error: string }[] = [];
  const visit = (step: string, v: unknown) => {
    if (v && typeof v === "object") {
      const err = (v as { error?: unknown }).error;
      if (typeof err === "string") out.push({ step: STEP_LABEL[step] ?? step, error: explainError(err) });
      else if (Array.isArray(v)) v.forEach((x) => visit(step, x));
      else Object.entries(v as Record<string, unknown>).forEach(([, x]) => x && typeof x === "object" && visit(step, x));
    } else if (typeof v === "string" && v.startsWith("error: ")) out.push({ step: `${STEP_LABEL[step] ?? step}`, error: explainError(v.slice(7)) });
  };
  for (const [k, v] of Object.entries(report)) visit(k, v);
  // Same cause in every step (e.g. no token): say it once.
  const seen = new Set<string>();
  return out.filter((p) => (seen.has(p.error) ? false : (seen.add(p.error), true)));
}

/** Non-error remarks of a run: steps skipped for time, history still to load. */
export function runNotes(run: { message: string | null } | null): string[] {
  if (!run?.message) return [];
  try {
    const report = JSON.parse(run.message) as Record<string, unknown>;
    const out: string[] = [];
    for (const [k, v] of Object.entries(report)) {
      if (v && typeof v === "object") {
        const o = v as { skipped?: unknown; note?: unknown };
        if (typeof o.note === "string") out.push(o.note);
        if (typeof o.skipped === "string") out.push(`${STEP_LABEL[k] ?? k}: ${o.skipped}`);
      }
    }
    return out;
  } catch {
    return [];
  }
}
