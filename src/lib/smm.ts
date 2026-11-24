import "server-only";
import { and, asc, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { accountSnapshots, adInsightsDaily, igStories, smmMonths, socialPosts } from "@/db/schema";
import { META } from "@/lib/config";
import { localDate } from "@/lib/dates";
import { graph } from "@/lib/meta/client";
import { directForMonth } from "@/lib/meta/direct";
import { MANUAL_FIELDS, nextMonth, prevMonth, type SmmData, type SmmRow } from "@/lib/smm-calc";

/** All months, oldest first, with hand-typed values laid over what was loaded. */
export async function loadSmm(): Promise<SmmRow[]> {
  const rows = await db.select().from(smmMonths).orderBy(asc(smmMonths.month));
  const current = localDate().slice(0, 7);
  return rows.map((r) => ({
    month: r.month,
    source: r.source === "report" ? "report" : "meta",
    d: { ...(r.data as SmmData), ...(r.overrides as SmmData) },
    notes: r.notes ?? {},
    manual: Object.keys(r.overrides ?? {}),
    partial: r.month >= current,
  }));
}

/** Save what a person typed in for a month. An empty value removes the hand-typed number. */
export async function saveSmmManual(month: string, values: Partial<Record<keyof SmmData, number | null>>) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Невірний місяць");
  const allowed = new Set(MANUAL_FIELDS.map((f) => f.key));
  const [row] = await db.select().from(smmMonths).where(eq(smmMonths.month, month));
  const overrides: Record<string, unknown> = { ...(row?.overrides ?? {}) };
  for (const [k, v] of Object.entries(values)) {
    if (!allowed.has(k as keyof SmmData)) continue;
    if (v === null || v === undefined || !Number.isFinite(v)) delete overrides[k];
    else overrides[k] = v;
  }
  await db
    .insert(smmMonths)
    .values({ month, overrides })
    .onConflictDoUpdate({ target: smmMonths.month, set: { overrides, updatedAt: new Date() } });
}

// ---------- loading from Meta ----------

const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const monthStart = (m: string) => `${m}-01T00:00:00Z`;

type TotalValue = { name: string; total_value?: { value?: number; breakdowns?: { results?: { dimension_values: string[]; value: number }[] }[] } };

/** One account-insights call; returns {} instead of failing when Meta refuses a metric. */
async function igInsights(params: Record<string, string | number>) {
  try {
    const r = await graph<{ data: TotalValue[] }>(`${META.igUserId}/insights`, { metric_type: "total_value", period: "day", ...params });
    return r.data;
  } catch (e) {
    console.warn("[smm] insights refused:", params.metric, e instanceof Error ? e.message : e);
    return [];
  }
}

/** Meta answers at most 30 days per call, so a month is read in pieces; these metrics add up across pieces. */
const ADDITIVE = ["views", "likes", "comments", "saves", "shares", "total_interactions", "profile_views"];

async function igMonth(since: number, until: number) {
  const out: Record<string, number> = {};
  const notes: Record<string, string> = {};
  const MAX = 30 * 86400;
  for (let a = since; a < until; a += MAX) {
    const b = Math.min(until, a + MAX);
    // Asked one by one: if Meta has retired one metric (it did with profile_views), the others still come.
    for (const metric of ADDITIVE) {
      for (const row of await igInsights({ metric, since: a, until: b })) {
        const v = row.total_value?.value;
        if (typeof v === "number") out[row.name] = (out[row.name] ?? 0) + v;
      }
    }
    for (const row of await igInsights({ metric: "follows_and_unfollows", breakdown: "follow_type", since: a, until: b })) {
      for (const res of row.total_value?.breakdowns?.[0]?.results ?? []) {
        const key = res.dimension_values[0] === "FOLLOWER" ? "follows" : res.dimension_values[0] === "NON_FOLLOWER" ? "unfollows" : null;
        if (key) out[key] = (out[key] ?? 0) + res.value;
      }
    }
  }
  // Reach does not add up (the same person in two halves counts once), so it is one call over at most 30 days.
  const reachSince = Math.max(since, until - MAX);
  for (const row of await igInsights({ metric: "reach", since: reachSince, until })) {
    if (typeof row.total_value?.value === "number") out.reach = row.total_value.value;
  }
  if (reachSince > since) notes.reach = "Meta віддає охоплення максимум за 30 днів: тут останні 30 днів місяця";
  return { values: out, notes };
}

/** Instagram impressions bought in the ad accounts: the paid part of views. */
async function paidInstagramImpressions(from: string, to: string) {
  let total = 0;
  let any = false;
  for (const id of META.adAccountIds) {
    try {
      const r = await graph<{ data: { publisher_platform: string; impressions: string }[] }>(`act_${id}/insights`, {
        level: "account",
        fields: "impressions",
        breakdowns: "publisher_platform",
        time_range: JSON.stringify({ since: from, until: to }),
      });
      for (const row of r.data) {
        if (row.publisher_platform === "instagram") {
          total += Number(row.impressions) || 0;
          any = true;
        }
      }
    } catch (e) {
      console.warn("[smm] paid impressions:", e instanceof Error ? e.message : e);
    }
  }
  return any ? total : null;
}

/** Share of followers by city and the male/female split, as Instagram shows them today. */
async function demographics(followers: number | null) {
  const out: Pick<SmmData, "cities" | "male" | "female"> = {};
  const read = async (breakdown: string) => {
    try {
      const r = await graph<{ data: TotalValue[] }>(`${META.igUserId}/insights`, {
        metric: "follower_demographics",
        period: "lifetime",
        metric_type: "total_value",
        breakdown,
      });
      return r.data[0]?.total_value?.breakdowns?.[0]?.results ?? [];
    } catch (e) {
      console.warn("[smm] demographics:", e instanceof Error ? e.message : e);
      return [];
    }
  };
  const cities = await read("city");
  const base = followers || cities.reduce((s, c) => s + c.value, 0);
  if (cities.length && base) {
    out.cities = Object.fromEntries(
      [...cities]
        .sort((a, b) => b.value - a.value)
        .slice(0, 10)
        .map((c) => [c.dimension_values[0].split(",")[0].trim(), Math.round((c.value / base) * 1000) / 10]),
    );
  }
  const gender = await read("gender");
  const m = gender.find((g) => g.dimension_values[0] === "M")?.value ?? 0;
  const f = gender.find((g) => g.dimension_values[0] === "F")?.value ?? 0;
  if (m + f) {
    out.male = Math.round((m / (m + f)) * 1000) / 10;
    out.female = Math.round((1000 - out.male * 10)) / 10;
  }
  return out;
}

/** Followers on the last day of the month that the dashboard saw (or the latest, for the running month). */
async function followersAt(fromDay: string, toDay: string) {
  const [r] = await db
    .select({ followers: accountSnapshots.followers })
    .from(accountSnapshots)
    .where(
      and(
        eq(accountSnapshots.platform, "ig"),
        isNotNull(accountSnapshots.followers),
        gte(accountSnapshots.date, fromDay),
        lt(accountSnapshots.date, toDay),
      ),
    )
    .orderBy(desc(accountSnapshots.date))
    .limit(1);
  return r?.followers ?? null;
}

/**
 * Fill one month from Meta and the dashboard's own data. Months that came from the team's report
 * are left as they are: Meta no longer gives most of that history.
 */
export async function refreshSmmMonth(month: string) {
  const [existing] = await db.select().from(smmMonths).where(eq(smmMonths.month, month));
  if (existing?.source === "report") return { month, skipped: "історія зі звіту" };

  const from = `${month}-01`;
  const to = `${nextMonth(month)}-01`;
  const today = localDate();
  const running = today < to;
  const lastDay = running ? today : new Date(Date.parse(to) - 86_400_000).toISOString().slice(0, 10);

  const since = unix(monthStart(month));
  const until = running ? Math.floor(Date.now() / 1000) : unix(monthStart(nextMonth(month)));
  const ig = await igMonth(since, until);
  const v = ig.values;
  const notes: Record<string, string> = { ...ig.notes };

  const [prev] = await db.select().from(smmMonths).where(eq(smmMonths.month, prevMonth(month)));
  const prevEnd = (prev?.overrides as SmmData | undefined)?.followersEnd ?? (prev?.data as SmmData | undefined)?.followersEnd ?? null;
  const followersEnd = await followersAt(from, to);
  const followersStart = prevEnd ?? (await followersAt(prevMonth(month) + "-01", from));

  const [ads] = await db
    .select({
      spend: sql<string>`coalesce(sum(${adInsightsDaily.spend}), 0)`,
      leads: sql<number>`coalesce(sum(${adInsightsDaily.leads}), 0)::int`,
      days: sql<number>`count(distinct ${adInsightsDaily.date})::int`,
    })
    .from(adInsightsDaily)
    .where(and(gte(adInsightsDaily.date, from), lt(adInsightsDaily.date, to)));

  const counts = await db
    .select({ type: socialPosts.contentType, n: sql<number>`count(*)::int` })
    .from(socialPosts)
    .where(and(eq(socialPosts.platform, "ig"), gte(socialPosts.publishedAt, new Date(monthStart(month))), lt(socialPosts.publishedAt, new Date(monthStart(nextMonth(month))))))
    .groupBy(socialPosts.contentType);
  const count = (...types: string[]) => counts.filter((c) => types.includes(c.type)).reduce((s, c) => s + c.n, 0);
  const [stories] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(igStories)
    .where(and(gte(igStories.publishedAt, new Date(monthStart(month))), lt(igStories.publishedAt, new Date(monthStart(nextMonth(month))))));

  const paid = await paidInstagramImpressions(from, lastDay);
  const direct = await directForMonth(monthStart(month), monthStart(nextMonth(month)));
  if (direct) notes.directFromContent = "З контенту — розмови, що почалися з відповіді на сторіс або поширеного допису";
  else notes.directNew = "Розмови з директу ще не завантажені. Натисніть «Оновити з Meta»: поруч з кнопкою буде видно, скільки прочитано або що завадило";
  const viewsTotal = v.views ?? null;
  const viewsPaid = paid !== null && viewsTotal !== null ? Math.min(paid, viewsTotal) : null;
  if (viewsPaid !== null) notes.viewsPaid = "Реклама — покази в Instagram з рекламних кабінетів; органіка — решта переглядів";
  if (v.profile_views === undefined) notes.profileVisits = "Meta більше не віддає відвідування профілю через API — впишіть з Instagram вручну";
  notes.stories = "Сторіс рахуються з моменту, коли дашборд почав їх записувати (API показує сторіс лише 24 години)";

  const data: SmmData = {
    followersStart: followersStart ?? undefined,
    followersEnd: followersEnd ?? undefined,
    follows: v.follows,
    unfollows: v.unfollows,
    profileVisits: v.profile_views,
    viewsTotal: viewsTotal ?? undefined,
    viewsPaid: viewsPaid ?? undefined,
    viewsOrganic: viewsPaid !== null && viewsTotal !== null ? viewsTotal - viewsPaid : undefined,
    reach: v.reach,
    likes: v.likes,
    comments: v.comments,
    saves: v.saves,
    shares: v.shares,
    interactions: v.total_interactions,
    carousels: count("carousel"),
    reels: count("reel", "video"),
    stories: stories?.n ?? 0,
    directNew: direct?.directNew,
    directFromContent: direct?.directFromContent,
    leads: ads?.days ? ads.leads : undefined,
    spend: ads?.days ? Math.round(Number(ads.spend) * 100) / 100 : undefined,
  };
  // Audience shares are a picture of "now": only the running month (or the one that just ended) gets them.
  const old = (existing?.data ?? {}) as SmmData;
  const demo = running || !old.cities ? await demographics(followersEnd) : {};
  const merged = { ...old, ...Object.fromEntries(Object.entries({ ...data, ...demo }).filter(([, x]) => x !== undefined)) };
  if (!merged.activeTime && prev) merged.activeTime = (prev.data as SmmData).activeTime;

  await db
    .insert(smmMonths)
    .values({ month, source: "meta", data: merged, notes })
    .onConflictDoUpdate({ target: smmMonths.month, set: { data: merged, notes, updatedAt: new Date() } });
  return { month, ok: true };
}

/** The running month, plus the one before it during the first week (Meta settles numbers a few days late). */
export async function refreshSmm() {
  const today = localDate();
  const month = today.slice(0, 7);
  const done = [await refreshSmmMonth(month)];
  if (Number(today.slice(8, 10)) <= 7) done.unshift(await refreshSmmMonth(prevMonth(month)));
  return { months: done };
}
