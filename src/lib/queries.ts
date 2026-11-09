import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { accountSnapshots, adInsightsDaily, ads, campaigns, leadEvents, leads, regions, socialPosts } from "@/db/schema";
import type { Filters } from "@/lib/filters";
import { SLA_LOOKBACK_DAYS, SLA_MINUTES } from "@/lib/config";
import { QUALIFIED, funnelDepth, type StatusCode } from "@/lib/statuses";

const num = (v: unknown) => Number(v ?? 0) || 0;
const JUNK: StatusCode[] = ["spam", "supplier", "not_relevant"];

// ---------- Ads ----------

/**
 * Spend in different currencies is never added up. With no region chosen and several ad account currencies,
 * the page shows one currency at a time (`?cur=`, default: the one with most spend), and leads are narrowed to
 * the regions in that currency. Returns the filters to use plus the currencies for the switch.
 */
export async function withCurrency(f: Filters): Promise<{ f: Filters; currencies: string[] }> {
  const rows = await db
    .select({ currency: adInsightsDaily.currency })
    .from(adInsightsDaily)
    .groupBy(adInsightsDaily.currency)
    .orderBy(desc(sql`sum(${adInsightsDaily.spend})`));
  const currencies = rows.map((r) => r.currency).filter(Boolean) as string[];
  if (f.region || currencies.length < 2) return { f: { ...f, currency: null, currencyRegions: null }, currencies: [] };
  const currency = f.currency && currencies.includes(f.currency) ? f.currency : currencies[0];
  const regs = await db.select({ code: regions.code }).from(regions).where(eq(regions.currency, currency));
  return { f: { ...f, currency, currencyRegions: regs.map((r) => r.code) }, currencies };
}

function adWhere(f: Filters, from: string, to: string): SQL[] {
  const w: SQL[] = [gte(adInsightsDaily.date, from), lte(adInsightsDaily.date, to)];
  if (f.currency) w.push(eq(adInsightsDaily.currency, f.currency));
  if (f.region) w.push(eq(campaigns.regionCode, f.region));
  if (f.campaign) w.push(eq(adInsightsDaily.campaignId, f.campaign));
  return w;
}

export async function adTotals(f: Filters, from = f.from, to = f.to) {
  const [r] = await db
    .select({
      spend: sql<string>`coalesce(sum(${adInsightsDaily.spend}),0)`,
      impressions: sql<string>`coalesce(sum(${adInsightsDaily.impressions}),0)`,
      clicks: sql<string>`coalesce(sum(${adInsightsDaily.clicks}),0)`,
      linkClicks: sql<string>`coalesce(sum(${adInsightsDaily.linkClicks}),0)`,
      leads: sql<string>`coalesce(sum(${adInsightsDaily.leads}),0)`,
      currency: sql<string>`max(${adInsightsDaily.currency})`,
    })
    .from(adInsightsDaily)
    .leftJoin(campaigns, eq(campaigns.id, adInsightsDaily.campaignId))
    .where(and(...adWhere(f, from, to)));
  const spend = num(r?.spend);
  const impressions = num(r?.impressions);
  const linkClicks = num(r?.linkClicks);
  const metaLeads = num(r?.leads);
  return {
    spend,
    impressions,
    clicks: num(r?.clicks),
    linkClicks,
    metaLeads,
    currency: r?.currency ?? "AED",
    cpm: impressions ? (spend / impressions) * 1000 : 0,
    ctr: impressions ? linkClicks / impressions : 0,
    cpc: linkClicks ? spend / linkClicks : 0,
    cpl: metaLeads ? spend / metaLeads : 0,
  };
}

export async function adDaily(f: Filters) {
  const rows = await db
    .select({
      date: adInsightsDaily.date,
      spend: sql<string>`sum(${adInsightsDaily.spend})`,
      leads: sql<string>`sum(${adInsightsDaily.leads})`,
      clicks: sql<string>`sum(${adInsightsDaily.linkClicks})`,
    })
    .from(adInsightsDaily)
    .leftJoin(campaigns, eq(campaigns.id, adInsightsDaily.campaignId))
    .where(and(...adWhere(f, f.from, f.to)))
    .groupBy(adInsightsDaily.date)
    .orderBy(asc(adInsightsDaily.date));
  return rows.map((r) => ({ date: r.date, spend: num(r.spend), leads: num(r.leads), clicks: num(r.clicks) }));
}

/** CRM outcomes per campaign or per ad, for leads created in the period. */
async function crmBy(key: "campaign" | "ad", f: Filters) {
  const col = key === "campaign" ? leads.campaignId : leads.adId;
  const rows = await db
    .select({
      id: col,
      total: sql<string>`count(*)`,
      qualified: sql<string>`count(*) filter (where ${inArray(leads.status, QUALIFIED)})`,
      won: sql<string>`count(*) filter (where ${leads.status} = 'won')`,
      revenue: sql<string>`coalesce(sum(${leads.dealAmount}) filter (where ${leads.status} = 'won'),0)`,
    })
    .from(leads)
    .where(and(...leadWhere(f, f.from, f.to)))
    .groupBy(col);
  // Deal amounts by currency: ROMI is only computed against spend in the same currency
  // (a deal without a currency is taken to be in the campaign's currency).
  const rev = await db
    .select({ id: col, cur: sql<string>`coalesce(${leads.dealCurrency}, '')`, amount: sql<string>`sum(${leads.dealAmount})` })
    .from(leads)
    .where(and(...leadWhere(f, f.from, f.to), eq(leads.status, "won")))
    .groupBy(col, sql`2`);
  const byCur = new Map<string, Record<string, number>>();
  for (const r of rev) {
    if (!r.id) continue;
    const m = byCur.get(r.id) ?? {};
    m[r.cur] = (m[r.cur] ?? 0) + num(r.amount);
    byCur.set(r.id, m);
  }
  return new Map(
    rows
      .filter((r) => r.id)
      .map((r) => [r.id!, { total: num(r.total), qualified: num(r.qualified), won: num(r.won), revenue: num(r.revenue), revenueByCurrency: byCur.get(r.id!) ?? {} }]),
  );
}

type CrmAgg = { total: number; qualified: number; won: number; revenue: number; revenueByCurrency: Record<string, number> };
const EMPTY_CRM: CrmAgg = { total: 0, qualified: 0, won: 0, revenue: 0, revenueByCurrency: {} };

/** Revenue comparable with spend (same currency or no currency set) and ROMI = (revenue − spend) ÷ spend. */
export function romiFor(spend: number, currency: string, byCurrency: Record<string, number>) {
  const revenue = (byCurrency[currency] ?? 0) + (byCurrency[""] ?? 0);
  const otherCurrency = Object.keys(byCurrency).some((c) => c && c !== currency);
  return { revenue, otherCurrency, romi: revenue && spend ? (revenue - spend) / spend : null };
}

export async function campaignTable(f: Filters) {
  const rows = await db
    .select({
      id: adInsightsDaily.campaignId,
      name: campaigns.name,
      region: campaigns.regionCode,
      status: campaigns.status,
      spend: sql<string>`sum(${adInsightsDaily.spend})`,
      impressions: sql<string>`sum(${adInsightsDaily.impressions})`,
      linkClicks: sql<string>`sum(${adInsightsDaily.linkClicks})`,
      leads: sql<string>`sum(${adInsightsDaily.leads})`,
      currency: sql<string>`max(${adInsightsDaily.currency})`,
    })
    .from(adInsightsDaily)
    .leftJoin(campaigns, eq(campaigns.id, adInsightsDaily.campaignId))
    .where(and(...adWhere(f, f.from, f.to)))
    .groupBy(adInsightsDaily.campaignId, campaigns.name, campaigns.regionCode, campaigns.status)
    .orderBy(desc(sql`sum(${adInsightsDaily.spend})`));
  const crm = await crmBy("campaign", f);
  return rows.map((r) => {
    const spend = num(r.spend);
    const c = crm.get(r.id ?? "") ?? EMPTY_CRM;
    return {
      ...romiFor(spend, r.currency ?? "AED", c.revenueByCurrency),
      currency: r.currency ?? "AED",
      id: r.id,
      name: r.name ?? r.id ?? "—",
      region: r.region,
      status: r.status,
      spend,
      impressions: num(r.impressions),
      linkClicks: num(r.linkClicks),
      metaLeads: num(r.leads),
      ctr: num(r.impressions) ? num(r.linkClicks) / num(r.impressions) : 0,
      cpl: num(r.leads) ? spend / num(r.leads) : 0,
      crm: c,
      costPerQualified: c.qualified ? spend / c.qualified : 0,
    };
  });
}

export async function creativeTable(f: Filters) {
  const rows = await db
    .select({
      adId: adInsightsDaily.adId,
      spend: sql<string>`sum(${adInsightsDaily.spend})`,
      impressions: sql<string>`sum(${adInsightsDaily.impressions})`,
      linkClicks: sql<string>`sum(${adInsightsDaily.linkClicks})`,
      leads: sql<string>`sum(${adInsightsDaily.leads})`,
      currency: sql<string>`max(${adInsightsDaily.currency})`,
    })
    .from(adInsightsDaily)
    .leftJoin(campaigns, eq(campaigns.id, adInsightsDaily.campaignId))
    .where(and(...adWhere(f, f.from, f.to)))
    .groupBy(adInsightsDaily.adId);
  const ids = rows.map((r) => r.adId);
  const meta = ids.length
    ? await db
        .select({ ad: ads, campaignName: campaigns.name, region: campaigns.regionCode })
        .from(ads)
        .leftJoin(campaigns, eq(campaigns.id, ads.campaignId))
        .where(inArray(ads.id, ids))
    : [];
  const byId = new Map(meta.map((m) => [m.ad.id, m]));
  const crm = await crmBy("ad", f);
  return rows
    .map((r) => {
      const m = byId.get(r.adId);
      const spend = num(r.spend);
      const impressions = num(r.impressions);
      const linkClicks = num(r.linkClicks);
      const metaLeads = num(r.leads);
      const c = crm.get(r.adId) ?? EMPTY_CRM;
      return {
        ...romiFor(spend, r.currency ?? "AED", c.revenueByCurrency),
        currency: r.currency ?? "AED",
        id: r.adId,
        name: m?.ad.name ?? r.adId,
        campaignName: m?.campaignName ?? null,
        region: m?.region ?? null,
        status: m?.ad.status ?? null,
        thumbnail: m?.ad.thumbnailUrl ?? m?.ad.imageUrl ?? null,
        body: m?.ad.body ?? null,
        permalink: m?.ad.permalink ?? m?.ad.previewLink ?? null,
        isVideo: !!m?.ad.videoId,
        spend,
        impressions,
        linkClicks,
        metaLeads,
        ctr: impressions ? linkClicks / impressions : 0,
        cpl: metaLeads ? spend / metaLeads : 0,
        crm: c,
        costPerQualified: c.qualified ? spend / c.qualified : 0,
      };
    })
    .filter((r) => !f.q || `${r.name} ${r.campaignName ?? ""} ${r.body ?? ""}`.toLowerCase().includes(f.q.toLowerCase()))
    .sort((a, b) => b.spend - a.spend);
}

export async function campaignOptions() {
  return db.select({ id: campaigns.id, name: campaigns.name, region: campaigns.regionCode }).from(campaigns).orderBy(asc(campaigns.name));
}

// ---------- Leads / CRM ----------

export function leadWhere(f: Filters, from: string, to: string): SQL[] {
  const w: SQL[] = [
    gte(leads.createdTime, new Date(from + "T00:00:00Z")),
    lte(leads.createdTime, new Date(to + "T23:59:59Z")),
  ];
  if (f.region) w.push(eq(leads.regionCode, f.region));
  else if (f.currencyRegions) w.push(f.currencyRegions.length ? inArray(leads.regionCode, f.currencyRegions) : sql`false`);
  if (f.platform) w.push(eq(leads.platform, f.platform));
  if (f.campaign) w.push(eq(leads.campaignId, f.campaign));
  return w;
}

export async function crmTotals(f: Filters, from = f.from, to = f.to) {
  const [r] = await db
    .select({
      total: sql<string>`count(*)`,
      junk: sql<string>`count(*) filter (where ${inArray(leads.status, JUNK)})`,
      qualified: sql<string>`count(*) filter (where ${inArray(leads.status, QUALIFIED)})`,
      meetings: sql<string>`count(*) filter (where ${inArray(leads.status, ["meeting", "proposal", "won"])})`,
      won: sql<string>`count(*) filter (where ${leads.status} = 'won')`,
      revenue: sql<string>`coalesce(sum(${leads.dealAmount}) filter (where ${leads.status} = 'won'),0)`,
      fresh: sql<string>`count(*) filter (where ${leads.status} = 'new')`,
    })
    .from(leads)
    .where(and(...leadWhere(f, from, to)));
  const rev = await db
    .select({ cur: sql<string>`coalesce(${leads.dealCurrency}, '')`, amount: sql<string>`sum(${leads.dealAmount})` })
    .from(leads)
    .where(and(...leadWhere(f, from, to), eq(leads.status, "won")))
    .groupBy(sql`1`);
  return {
    revenueByCurrency: Object.fromEntries(rev.map((x) => [x.cur, num(x.amount)])) as Record<string, number>,
    total: num(r?.total),
    junk: num(r?.junk),
    qualified: num(r?.qualified),
    meetings: num(r?.meetings),
    won: num(r?.won),
    revenue: num(r?.revenue),
    fresh: num(r?.fresh),
  };
}

export async function leadsDaily(f: Filters) {
  const rows = await db
    .select({
      date: sql<string>`to_char(${leads.createdTime} at time zone 'Asia/Dubai', 'YYYY-MM-DD')`,
      total: sql<string>`count(*)`,
      qualified: sql<string>`count(*) filter (where ${inArray(leads.status, QUALIFIED)})`,
    })
    .from(leads)
    .where(and(...leadWhere(f, f.from, f.to)))
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  return rows.map((r) => ({ date: r.date, total: num(r.total), qualified: num(r.qualified) }));
}

export async function leadList(f: Filters, opts: { status?: string | null; owner?: string | null; overdue?: boolean; limit?: number } = {}) {
  const w = opts.overdue ? [...overdueWhere(), ...(f.region ? [eq(leads.regionCode, f.region)] : [])] : leadWhere(f, f.from, f.to);
  if (opts.status) w.push(eq(leads.status, opts.status));
  if (opts.owner) w.push(eq(leads.owner, opts.owner));
  if (f.q) {
    const like = `%${f.q}%`;
    w.push(or(ilike(leads.fullName, like), ilike(leads.phone, like), ilike(leads.email, like), ilike(leads.city, like))!);
  }
  return db
    .select()
    .from(leads)
    .where(and(...w))
    .orderBy(desc(leads.createdTime))
    .limit(opts.limit ?? 500);
}

export async function statusCounts(f: Filters) {
  const rows = await db
    .select({ status: leads.status, n: sql<string>`count(*)` })
    .from(leads)
    .where(and(...leadWhere(f, f.from, f.to)))
    .groupBy(leads.status);
  return Object.fromEntries(rows.map((r) => [r.status, num(r.n)])) as Record<string, number>;
}

export async function owners() {
  const rows = await db.selectDistinct({ owner: leads.owner }).from(leads).where(sql`${leads.owner} is not null and ${leads.owner} <> ''`);
  return rows.map((r) => r.owner!).sort();
}

export async function leadDetail(id: string) {
  const [lead] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  if (!lead) return null;
  const events = await db.select().from(leadEvents).where(eq(leadEvents.leadId, id)).orderBy(desc(leadEvents.createdAt));
  const ad = lead.adId ? (await db.select().from(ads).where(eq(ads.id, lead.adId)).limit(1))[0] ?? null : null;
  return { lead, events, ad };
}

/** Median minutes from lead creation to the first move out of "new", and how many still wait. */
export async function responseSpeed(f: Filters) {
  const [r] = await db
    .select({
      median: sql<string>`percentile_cont(0.5) within group (order by extract(epoch from (${leads.firstContactAt} - ${leads.createdTime})) / 60)`,
      measured: sql<string>`count(${leads.firstContactAt})`,
      waiting: sql<string>`count(*) filter (where ${leads.status} = 'new')`,
    })
    .from(leads)
    .where(and(...leadWhere(f, f.from, f.to)));
  return { medianMinutes: r?.median ? num(r.median) : null, measured: num(r?.measured), waiting: num(r?.waiting) };
}

// ---------- Funnel ----------

export async function funnel(f: Filters) {
  const ad = await adTotals(f);
  const rows = await db
    .select({ status: leads.status, n: sql<string>`count(*)` })
    .from(leads)
    .where(and(...leadWhere(f, f.from, f.to)))
    .groupBy(leads.status);
  const depthCount = [0, 0, 0, 0, 0];
  let junk = 0;
  for (const r of rows) {
    const d = funnelDepth(r.status as StatusCode);
    if (d < 0) {
      junk += num(r.n);
      continue;
    }
    for (let i = 0; i <= d; i++) depthCount[i] += num(r.n);
  }
  const total = depthCount[0] + junk;
  return {
    stages: [
      { key: "impressions", label: "Покази реклами", value: ad.impressions },
      { key: "clicks", label: "Кліки", value: ad.linkClicks },
      { key: "leads", label: "Заявки", value: total },
      { key: "real", label: "Реальні ліди", value: depthCount[0] },
      { key: "contacted", label: "Контакт", value: depthCount[1] },
      { key: "meeting", label: "Зустріч", value: depthCount[2] },
      { key: "proposal", label: "КП надіслано", value: depthCount[3] },
      { key: "won", label: "Угода", value: depthCount[4] },
    ],
    junk,
    spend: ad.spend,
    currency: ad.currency,
  };
}

// ---------- Social ----------

export async function socialList(f: Filters) {
  const w: SQL[] = [
    gte(socialPosts.publishedAt, new Date(f.from + "T00:00:00Z")),
    lte(socialPosts.publishedAt, new Date(f.to + "T23:59:59Z")),
  ];
  if (f.platform) w.push(eq(socialPosts.platform, f.platform));
  if (f.type) w.push(eq(socialPosts.contentType, f.type));
  if (f.q) w.push(ilike(socialPosts.caption, `%${f.q}%`));
  return db.select().from(socialPosts).where(and(...w)).orderBy(desc(socialPosts.publishedAt)).limit(300);
}

export async function socialTotals(f: Filters, from = f.from, to = f.to) {
  const w: SQL[] = [
    gte(socialPosts.publishedAt, new Date(from + "T00:00:00Z")),
    lte(socialPosts.publishedAt, new Date(to + "T23:59:59Z")),
  ];
  if (f.platform) w.push(eq(socialPosts.platform, f.platform));
  if (f.type) w.push(eq(socialPosts.contentType, f.type));
  const [r] = await db
    .select({
      posts: sql<string>`count(*)`,
      reach: sql<string>`coalesce(sum(${socialPosts.reach}),0)`,
      likes: sql<string>`coalesce(sum(${socialPosts.likes}),0)`,
      comments: sql<string>`coalesce(sum(${socialPosts.comments}),0)`,
      saves: sql<string>`coalesce(sum(${socialPosts.saves}),0)`,
      shares: sql<string>`coalesce(sum(${socialPosts.shares}),0)`,
      views: sql<string>`coalesce(sum(${socialPosts.views}),0)`,
      profileVisits: sql<string>`coalesce(sum(${socialPosts.profileVisits}),0)`,
    })
    .from(socialPosts)
    .where(and(...w));
  return {
    posts: num(r?.posts),
    reach: num(r?.reach),
    likes: num(r?.likes),
    comments: num(r?.comments),
    saves: num(r?.saves),
    shares: num(r?.shares),
    views: num(r?.views),
    profileVisits: num(r?.profileVisits),
  };
}

export async function followers() {
  const rows = await db
    .select({ platform: accountSnapshots.platform, date: accountSnapshots.date, followers: accountSnapshots.followers })
    .from(accountSnapshots)
    .orderBy(desc(accountSnapshots.date))
    .limit(60);
  const latest = (p: string) => rows.find((r) => r.platform === p) ?? null;
  return { ig: latest("ig"), fb: latest("fb") };
}

/** Leads waiting in "New" longer than the response target (any period, last week only). */
export function overdueWhere(): SQL[] {
  return [
    eq(leads.status, "new"),
    lte(leads.createdTime, new Date(Date.now() - SLA_MINUTES * 60_000)),
    gte(leads.createdTime, new Date(Date.now() - SLA_LOOKBACK_DAYS * 86_400_000)),
  ];
}

export async function overdueLeads(region?: string | null) {
  const w = overdueWhere();
  if (region) w.push(eq(leads.regionCode, region));
  return db
    .select({ id: leads.id, fullName: leads.fullName, phone: leads.phone, createdTime: leads.createdTime, regionCode: leads.regionCode, owner: leads.owner })
    .from(leads)
    .where(and(...w))
    .orderBy(asc(leads.createdTime));
}

/** Response speed per owner for leads created in the period. */
export async function ownerSpeed(f: Filters) {
  const rows = await db
    .select({
      owner: sql<string>`coalesce(${leads.owner}, '')`,
      total: sql<string>`count(*)`,
      contacted: sql<string>`count(${leads.firstContactAt})`,
      median: sql<string | null>`percentile_cont(0.5) within group (order by extract(epoch from (${leads.firstContactAt} - ${leads.createdTime})) / 60)`,
      inSla: sql<string>`count(*) filter (where ${leads.firstContactAt} - ${leads.createdTime} <= make_interval(mins => ${SLA_MINUTES}))`,
      waiting: sql<string>`count(*) filter (where ${leads.status} = 'new')`,
    })
    .from(leads)
    .where(and(...leadWhere(f, f.from, f.to)))
    .groupBy(sql`1`)
    .orderBy(desc(sql`count(*)`));
  return rows.map((r) => ({
    owner: r.owner || null,
    total: num(r.total),
    contacted: num(r.contacted),
    medianMinutes: r.median === null ? null : num(r.median),
    slaShare: num(r.contacted) ? num(r.inSla) / num(r.contacted) : null,
    waiting: num(r.waiting),
  }));
}

/**
 * Creative fatigue, judged at the end of the period: link CTR of the last 7 days vs the 7 days before,
 * daily frequency (impressions ÷ reach, averaged per day) and how long the ad has been running.
 * "Tired" = running 14+ days, enough impressions to judge, CTR down 30%+ week over week.
 */
export async function creativeFatigue(to: string) {
  const d = (n: number) => new Date(Date.parse(to + "T00:00:00Z") - n * 86_400_000).toISOString().slice(0, 10);
  const [recent, life] = await Promise.all([
    db
      .select({
        adId: adInsightsDaily.adId,
        impr7: sql<string>`sum(${adInsightsDaily.impressions}) filter (where ${adInsightsDaily.date} > ${d(7)})`,
        clicks7: sql<string>`sum(${adInsightsDaily.linkClicks}) filter (where ${adInsightsDaily.date} > ${d(7)})`,
        reach7: sql<string>`sum(${adInsightsDaily.reach}) filter (where ${adInsightsDaily.date} > ${d(7)})`,
        imprPrev: sql<string>`sum(${adInsightsDaily.impressions}) filter (where ${adInsightsDaily.date} <= ${d(7)})`,
        clicksPrev: sql<string>`sum(${adInsightsDaily.linkClicks}) filter (where ${adInsightsDaily.date} <= ${d(7)})`,
      })
      .from(adInsightsDaily)
      .where(and(gte(adInsightsDaily.date, d(13)), lte(adInsightsDaily.date, to)))
      .groupBy(adInsightsDaily.adId),
    db
      .select({ adId: adInsightsDaily.adId, first: sql<string>`min(${adInsightsDaily.date})` })
      .from(adInsightsDaily)
      .where(sql`${adInsightsDaily.impressions} > 0`)
      .groupBy(adInsightsDaily.adId),
  ]);
  const firstDay = new Map(life.map((r) => [r.adId, String(r.first)]));
  return new Map(
    recent.map((r) => {
      const ctr7 = num(r.impr7) ? num(r.clicks7) / num(r.impr7) : null;
      const ctrPrev = num(r.imprPrev) ? num(r.clicksPrev) / num(r.imprPrev) : null;
      const change = ctr7 !== null && ctrPrev ? (ctr7 - ctrPrev) / ctrPrev : null;
      const first = firstDay.get(r.adId);
      const daysRunning = first ? Math.round((Date.parse(to) - Date.parse(first)) / 86_400_000) + 1 : 0;
      const frequency = num(r.reach7) ? num(r.impr7) / num(r.reach7) : null;
      const tired = daysRunning >= 14 && num(r.impr7) >= 2000 && change !== null && change <= -0.3;
      return [r.adId, { ctr7, ctrChange: change, frequency, daysRunning, tired }];
    }),
  );
}
