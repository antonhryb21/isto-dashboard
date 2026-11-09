import "server-only";
import { and, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { accountSnapshots, adInsightsDaily, campaigns, leads, regions } from "@/db/schema";
import { APP_TIMEZONE } from "@/lib/dates";
import { QUALIFIED } from "@/lib/statuses";
import { META } from "@/lib/config";

export type Grain = "day" | "week" | "month" | "year";
export const GRAINS: { key: Grain; label: string }[] = [
  { key: "day", label: "День" },
  { key: "week", label: "Тиждень" },
  { key: "month", label: "Місяць" },
  { key: "year", label: "Рік" },
];

export type Bucket = { key: string; from: string; to: string; label: string; group: string };

export type ReportCell = {
  spend: number;
  clicks: number;
  impressions: number;
  leads: number;
  pageEngagement: number;
  postReactions: number;
  postComments: number;
  postSaves: number;
  postShares: number;
  newFollowers: number | null; // null = no follower data for this period
  followerSpend: number; // spend on the days that have follower data, for an honest cost per follower
  // From the CRM: leads created in the period and how far they got.
  crmLeads: number; // without spam / supplier / not relevant
  qualified: number;
  meetings: number;
  won: number;
  revenue: number; // won deals in the report currency (or without a currency)
};

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const parse = (s: string) => Date.parse(s + "T00:00:00Z");
const addDays = (s: string, n: number) => iso(parse(s) + n * DAY);
const num = (v: unknown) => Number(v ?? 0) || 0;

const MONTHS = ["Січень", "Лютий", "Березень", "Квітень", "Травень", "Червень", "Липень", "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень"];
const MON_SHORT = ["січ", "лют", "бер", "кві", "тра", "чер", "лип", "сер", "вер", "жов", "лис", "гру"];

function mondayOf(s: string) {
  const d = new Date(parse(s));
  const wd = (d.getUTCDay() + 6) % 7; // Monday = 0
  return addDays(s, -wd);
}

const shortDate = (s: string) => `${Number(s.slice(8, 10))} ${MON_SHORT[Number(s.slice(5, 7)) - 1]}`;

/**
 * The columns of a report. Day and week reports page back in fixed windows (`page` 0 = the latest);
 * month reports show one calendar year; year reports show every year from `firstYear`.
 */
export function buckets(
  grain: Grain,
  today: string,
  opts: { page: number; year: number; firstYear: number; range?: { from: string; to: string } | null },
): Bucket[] {
  if (opts.range) return rangeBuckets(grain, opts.range.from, opts.range.to);
  const out: Bucket[] = [];
  if (grain === "day") {
    const end = addDays(today, -opts.page * 14);
    for (let i = 13; i >= 0; i--) {
      const d = addDays(end, -i);
      out.push({ key: d, from: d, to: d, label: shortDate(d), group: d.slice(0, 4) });
    }
  } else if (grain === "week") {
    const lastMon = addDays(mondayOf(today), -opts.page * 12 * 7);
    for (let i = 11; i >= 0; i--) {
      const from = addDays(lastMon, -i * 7);
      const to = addDays(from, 6);
      out.push({ key: from, from, to, label: `${shortDate(from)} – ${shortDate(to)}`, group: from.slice(0, 4) });
    }
  } else if (grain === "month") {
    const y = opts.year;
    const lastMonth = y === Number(today.slice(0, 4)) ? Number(today.slice(5, 7)) : 12;
    for (let m = 1; m <= lastMonth; m++) {
      const from = `${y}-${String(m).padStart(2, "0")}-01`;
      const to = addDays(m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`, -1);
      out.push({ key: from, from, to, label: MONTHS[m - 1], group: String(y) });
    }
  } else {
    const thisYear = Number(today.slice(0, 4));
    for (let y = Math.min(opts.firstYear, thisYear); y <= thisYear; y++) {
      out.push({ key: `${y}-01-01`, from: `${y}-01-01`, to: `${y}-12-31`, label: String(y), group: "Роки" });
    }
  }
  return out;
}

export const MAX_COLUMNS = 400;

const startOf = (grain: Grain, d: string) =>
  grain === "day" ? d : grain === "week" ? mondayOf(d) : grain === "month" ? d.slice(0, 8) + "01" : d.slice(0, 5) + "01-01";

function nextStart(grain: Grain, start: string) {
  if (grain === "day") return addDays(start, 1);
  if (grain === "week") return addDays(start, 7);
  const y = Number(start.slice(0, 4));
  const m = Number(start.slice(5, 7));
  if (grain === "year") return `${y + 1}-01-01`;
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

/** Columns for a chosen period: whole days/weeks/months/years, with the first and last clipped to the period. */
function rangeBuckets(grain: Grain, from: string, to: string): Bucket[] {
  const out: Bucket[] = [];
  const multiYear = from.slice(0, 4) !== to.slice(0, 4);
  for (let start = startOf(grain, from); start <= to && out.length < MAX_COLUMNS; start = nextStart(grain, start)) {
    const end = addDays(nextStart(grain, start), -1);
    const a = start < from ? from : start;
    const b = end > to ? to : end;
    const clipped = a !== start || b !== end;
    let label: string;
    if (grain === "day") label = shortDate(a);
    else if (grain === "week") label = `${shortDate(a)} – ${shortDate(b)}`;
    else if (grain === "month") {
      label = `${MONTHS[Number(start.slice(5, 7)) - 1]}${multiYear ? ` ${start.slice(0, 4)}` : ""}`;
      if (clipped) label += ` (${Number(a.slice(8, 10))}–${Number(b.slice(8, 10))})`;
    } else label = clipped ? `${start.slice(0, 4)} (${shortDate(a)} – ${shortDate(b)})` : start.slice(0, 4);
    out.push({ key: start, from: a, to: b, label, group: start.slice(0, 4) });
  }
  return out;
}

/** Currencies the ad accounts report in, most spent first. Spend in different currencies is never added up. */
export async function reportCurrencies(): Promise<string[]> {
  const rows = await db
    .select({ currency: adInsightsDaily.currency, spend: sql<string>`sum(${adInsightsDaily.spend})` })
    .from(adInsightsDaily)
    .groupBy(adInsightsDaily.currency)
    .orderBy(sql`2 desc`);
  return rows.map((r) => r.currency).filter(Boolean) as string[];
}

export async function firstDataYear(): Promise<number> {
  const [r] = await db.select({ d: sql<string | null>`min(${adInsightsDaily.date})` }).from(adInsightsDaily);
  return r?.d ? Number(String(r.d).slice(0, 4)) : new Date().getUTCFullYear();
}

export async function reportData(
  grain: Grain,
  cols: Bucket[],
  opts: { currency: string | null; region: string | null },
): Promise<{ cells: Record<string, ReportCell>; total: ReportCell }> {
  const empty = (): ReportCell => ({
    spend: 0,
    clicks: 0,
    impressions: 0,
    leads: 0,
    pageEngagement: 0,
    postReactions: 0,
    postComments: 0,
    postSaves: 0,
    postShares: 0,
    newFollowers: null,
    followerSpend: 0,
    crmLeads: 0,
    qualified: 0,
    meetings: 0,
    won: 0,
    revenue: 0,
  });
  const cells: Record<string, ReportCell> = Object.fromEntries(cols.map((c) => [c.key, empty()]));
  if (!cols.length) return { cells, total: empty() };
  const from = cols[0].from;
  const to = cols[cols.length - 1].to;
  // Postgres weeks start on Monday, same as `mondayOf`.
  const trunc = (col: SQL | unknown) => sql<string>`to_char(date_trunc(${sql.raw(`'${grain}'`)}, ${col}), 'YYYY-MM-DD')`;

  const w: SQL[] = [gte(adInsightsDaily.date, from), lte(adInsightsDaily.date, to)];
  if (opts.currency) w.push(eq(adInsightsDaily.currency, opts.currency));
  if (opts.region) w.push(eq(campaigns.regionCode, opts.region));
  const bucket = trunc(adInsightsDaily.date);
  const ads = await db
    .select({
      b: bucket,
      spend: sql<string>`sum(${adInsightsDaily.spend})`,
      clicks: sql<string>`sum(${adInsightsDaily.clicks})`,
      impressions: sql<string>`sum(${adInsightsDaily.impressions})`,
      leads: sql<string>`sum(${adInsightsDaily.leads})`,
      pageEngagement: sql<string>`sum(${adInsightsDaily.pageEngagement})`,
      postReactions: sql<string>`sum(${adInsightsDaily.postReactions})`,
      postComments: sql<string>`sum(${adInsightsDaily.postComments})`,
      postSaves: sql<string>`sum(${adInsightsDaily.postSaves})`,
      postShares: sql<string>`sum(${adInsightsDaily.postShares})`,
      // Written with explicit aliases: inside select fields the ORM renders bare column names, which made the subquery match every day.
      followerSpend: sql<string>`coalesce(sum("ad_insights_daily"."spend") filter (where exists (
        select 1 from "account_snapshots" s
        where s.platform = 'ig' and s.account_id = ${META.igUserId} and s.new_followers is not null
          and s.date = "ad_insights_daily"."date")), 0)`,
    })
    .from(adInsightsDaily)
    .leftJoin(campaigns, eq(campaigns.id, adInsightsDaily.campaignId))
    .where(and(...w))
    .groupBy(bucket);

  for (const r of ads) {
    const c = cells[r.b];
    if (!c) continue;
    c.spend = num(r.spend);
    c.clicks = num(r.clicks);
    c.impressions = num(r.impressions);
    c.leads = num(r.leads);
    c.pageEngagement = num(r.pageEngagement);
    c.postReactions = num(r.postReactions);
    c.postComments = num(r.postComments);
    c.postSaves = num(r.postSaves);
    c.postShares = num(r.postShares);
    c.followerSpend = num(r.followerSpend);
  }

  const fb = trunc(accountSnapshots.date);
  const fol = await db
    .select({ b: fb, n: sql<string>`sum(${accountSnapshots.newFollowers})`, days: sql<string>`count(${accountSnapshots.newFollowers})` })
    .from(accountSnapshots)
    .where(
      and(
        eq(accountSnapshots.platform, "ig"),
        eq(accountSnapshots.accountId, META.igUserId),
        gte(accountSnapshots.date, from),
        lte(accountSnapshots.date, to),
      ),
    )
    .groupBy(fb);
  for (const r of fol) {
    const c = cells[r.b];
    if (c && num(r.days) > 0) c.newFollowers = num(r.n);
  }

  // CRM: leads bucketed by creation day in the app timezone; narrowed to the region, or to the regions of the report currency.
  const lw: SQL[] = [
    gte(leads.createdTime, new Date(Date.parse(from + "T00:00:00Z") - 86_400_000)),
    lte(leads.createdTime, new Date(Date.parse(to + "T23:59:59Z") + 86_400_000)),
  ];
  if (opts.region) lw.push(eq(leads.regionCode, opts.region));
  else if (opts.currency) {
    const regs = await db.select({ code: regions.code }).from(regions).where(eq(regions.currency, opts.currency));
    const all = await db.select({ code: regions.code, currency: regions.currency }).from(regions);
    // Only narrow when regions really differ in currency.
    if (new Set(all.map((r) => r.currency)).size > 1) lw.push(regs.length ? inArray(leads.regionCode, regs.map((r) => r.code)) : sql`false`);
  }
  const localDay = sql`(${leads.createdTime} at time zone ${APP_TIMEZONE})::date`;
  const lb = sql<string>`to_char(date_trunc(${sql.raw(`'${grain}'`)}, ${localDay}), 'YYYY-MM-DD')`;
  const crm = await db
    .select({
      b: lb,
      leads: sql<string>`count(*) filter (where ${leads.status} not in ('spam','supplier','not_relevant'))`,
      qualified: sql<string>`count(*) filter (where ${inArray(leads.status, QUALIFIED)})`,
      meetings: sql<string>`count(*) filter (where ${inArray(leads.status, ["meeting", "proposal", "won"])})`,
      won: sql<string>`count(*) filter (where ${leads.status} = 'won')`,
      revenue: sql<string>`coalesce(sum(${leads.dealAmount}) filter (where ${leads.status} = 'won' and (${leads.dealCurrency} is null or ${leads.dealCurrency} = ${opts.currency ?? ""} or ${opts.currency ?? ""} = '')), 0)`,
    })
    .from(leads)
    .where(and(...lw, sql`${localDay} between ${from}::date and ${to}::date`))
    .groupBy(sql`1`); // positional: the bucket expression carries bound parameters
  for (const r of crm) {
    const c = cells[r.b];
    if (!c) continue;
    c.crmLeads = num(r.leads);
    c.qualified = num(r.qualified);
    c.meetings = num(r.meetings);
    c.won = num(r.won);
    c.revenue = num(r.revenue);
  }

  const total = empty();
  for (const c of Object.values(cells)) {
    for (const k of Object.keys(c) as (keyof ReportCell)[]) {
      if (k === "newFollowers") {
        if (c.newFollowers !== null) total.newFollowers = (total.newFollowers ?? 0) + c.newFollowers;
      } else total[k] += c[k];
    }
  }
  return { cells, total };
}
