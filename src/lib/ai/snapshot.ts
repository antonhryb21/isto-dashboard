import "server-only";
import { competitorTable } from "@/lib/competitors";
import { daysAgo, localDate } from "@/lib/dates";
import type { Filters } from "@/lib/filters";
import {
  adTotals,
  campaignTable,
  creativeFatigue,
  creativeTable,
  crmTotals,
  followers,
  overdueLeads,
  ownerSpeed,
  responseSpeed,
  socialTotals,
  statusCounts,
  withCurrency,
} from "@/lib/queries";
import { buckets, reportData } from "@/lib/reports";
import { lastSync, runProblems } from "@/lib/sync";
import { monthPacing } from "@/lib/targets";

const r0 = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n));
const r2 = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);
const pct = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n * 1000) / 10);

/** A ready comparison, so the model quotes it instead of doing its own arithmetic. */
function change(label: string, unit: string, prev: number | null, last: number | null) {
  const changePct = prev && last !== null ? Math.round(((last - prev) / prev) * 1000) / 10 : null;
  return {
    metric: label,
    unit,
    prev30: prev,
    last30: last,
    changePct,
    direction: changePct === null ? "немає з чим порівняти" : changePct > 0 ? "зросло" : changePct < 0 ? "знизилось" : "без змін",
  };
}

function base(from: string, to: string, prevFrom: string, prevTo: string): Filters {
  return { from, to, prevFrom, prevTo, preset: "custom", region: null, platform: null, campaign: null, type: null, q: null, currency: null, currencyRegions: null };
}

/**
 * Everything the AI advisor sees: aggregated numbers only, last 30 days vs the 30 before, per ad account currency.
 * No lead names, phones or emails ever leave the database.
 */
export async function buildSnapshot() {
  const to = daysAgo(1); // yesterday: today is still incomplete
  const from = daysAgo(30);
  const prevTo = daysAgo(31);
  const prevFrom = daysAgo(60);
  const f0 = base(from, to, prevFrom, prevTo);
  const { currencies } = await withCurrency(f0);

  const markets = [];
  for (const cur of currencies.length ? currencies : [null]) {
    const { f } = await withCurrency({ ...f0, currency: cur });
    const [ad, adPrev, crm, crmPrev, camps, creatives, fatigue, plan, speed] = await Promise.all([
      adTotals(f),
      adTotals(f, prevFrom, prevTo),
      crmTotals(f),
      crmTotals(f, prevFrom, prevTo),
      campaignTable(f),
      creativeTable(f),
      creativeFatigue(to),
      monthPacing(f),
      responseSpeed(f),
    ]);
    const weeks = buckets("week", to, { page: 0, year: 0, firstYear: 0 }).slice(-8);
    const wk = await reportData("week", weeks, { currency: cur, region: null });
    const real = crm.total - crm.junk;
    const realPrev = crmPrev.total - crmPrev.junk;
    const money = cur ?? ad.currency;
    markets.push({
      currency: money,
      regions: f.currencyRegions,
      // Use these for every "було → стало": prev30 is the earlier period, last30 the recent one.
      changes: [
        change("витрати", money, r0(adPrev.spend), r0(ad.spend)),
        change("ліди за Meta", "шт", adPrev.metaLeads, ad.metaLeads),
        change("ціна ліда за Meta (metaCpl)", money, adPrev.metaLeads ? r0(adPrev.cpl) : null, ad.metaLeads ? r0(ad.cpl) : null),
        change("реальні ліди в CRM (без спаму)", "шт", realPrev, real),
        change("ціна реального ліда в CRM", money, crmPrev.adLeads ? r0(adPrev.spend / crmPrev.adLeads) : null, crm.adLeads ? r0(ad.spend / crm.adLeads) : null),
        change("якісні ліди", "шт", crmPrev.qualified, crm.qualified),
        change("CTR", "%", pct(adPrev.ctr), pct(ad.ctr)),
      ],
      ads: {
        last30: { spend: r0(ad.spend), impressions: ad.impressions, linkClicks: ad.linkClicks, ctrPct: pct(ad.ctr), cpm: r2(ad.cpm), metaLeads: ad.metaLeads, metaCpl: r0(ad.cpl) },
        prev30: { spend: r0(adPrev.spend), impressions: adPrev.impressions, linkClicks: adPrev.linkClicks, ctrPct: pct(adPrev.ctr), cpm: r2(adPrev.cpm), metaLeads: adPrev.metaLeads, metaCpl: r0(adPrev.cpl) },
      },
      crm: {
        last30: { leads: crm.total, junk: crm.junk, realLeads: real, addedByHand: crm.manual, qualified: crm.qualified, meetings: crm.meetings, won: crm.won, revenue: crm.revenueByCurrency, costPerRealLead: crm.adLeads ? r0(ad.spend / crm.adLeads) : null, costPerQualified: crm.adQualified ? r0(ad.spend / crm.adQualified) : null },
        prev30: { leads: crmPrev.total, junk: crmPrev.junk, realLeads: realPrev, addedByHand: crmPrev.manual, qualified: crmPrev.qualified, meetings: crmPrev.meetings, won: crmPrev.won, revenue: crmPrev.revenueByCurrency, costPerRealLead: crmPrev.adLeads ? r0(adPrev.spend / crmPrev.adLeads) : null, costPerQualified: crmPrev.adQualified ? r0(adPrev.spend / crmPrev.adQualified) : null },
        responseMedianWorkMinutes: r0(speed.medianMinutes),
      },
      weekly: weeks.map((w) => {
        const c = wk.cells[w.key];
        return { week: w.from, spend: r0(c.spend), metaLeads: c.leads, crmLeads: c.crmLeads, qualified: c.qualified, won: c.won, ctrPct: c.impressions ? pct(c.clicks / c.impressions) : null };
      }),
      campaigns: camps.slice(0, 12).map((c) => ({
        name: c.name,
        status: c.status,
        spend: r0(c.spend),
        ctrPct: pct(c.ctr),
        metaLeads: c.metaLeads,
        metaCpl: r0(c.cpl),
        crmLeads: c.crm.total,
        qualified: c.crm.qualified,
        costPerQualified: r0(c.costPerQualified),
        won: c.crm.won,
        revenue: r0(c.revenue),
        romiPct: pct(c.romi),
      })),
      creatives: creatives.slice(0, 15).map((c) => {
        const fa = fatigue.get(c.id);
        return {
          name: c.name,
          campaign: c.campaignName,
          status: c.status,
          video: c.isVideo,
          spend: r0(c.spend),
          ctrPct: pct(c.ctr),
          metaLeads: c.metaLeads,
          qualified: c.crm.qualified,
          costPerQualified: r0(c.costPerQualified),
          daysRunning: fa?.daysRunning ?? null,
          ctrWeekOverWeekPct: pct(fa?.ctrChange),
          dailyFrequency: r2(fa?.frequency),
          tired: fa?.tired ?? false,
        };
      }),
      monthPlan: plan
        ? { month: plan.from.slice(0, 7), dayOfMonth: plan.elapsed, daysInMonth: plan.daysInMonth, items: plan.items.map((p) => ({ metric: p.key, target: r0(p.target), actual: r0(p.actual), forecast: r0(p.forecast) })) }
        : null,
    });
  }

  const fAll = base(from, to, prevFrom, prevTo);
  const [statuses, owners, overdue, social, socialPrev, fol, rivals, last] = await Promise.all([
    statusCounts(fAll),
    ownerSpeed(fAll),
    overdueLeads(),
    socialTotals(fAll),
    socialTotals(fAll, prevFrom, prevTo),
    followers(),
    competitorTable({ ...fAll }),
    lastSync(),
  ]);

  return {
    business: "ISTO — архітектурне бюро й студія дизайну інтерʼєрів; ринки: Дубай (AED), Європа й Румунія (USD). Ліди переважно з лід-форм Meta.",
    generatedFor: localDate(),
    period: { from, to, comparedWith: { from: prevFrom, to: prevTo } },
    dataQuality: { lastSyncProblems: runProblems(last).map((p) => `${p.step}: ${p.error}`) },
    markets,
    crmAllMarkets: {
      statusCountsLast30: statuses,
      responseByOwner: owners.map((o) => ({ owner: o.owner ?? "не призначено", leads: o.total, contacted: o.contacted, medianMinutes: r0(o.medianMinutes), withinSlaPct: pct(o.slaShare), waiting: o.waiting })),
      overdueNowCount: overdue.length,
      note: "medianMinutes і overdue рахуються в робочих хвилинах (нічні ліди не штрафуються). addedByHand — ліди, додані в CRM вручну (дзвінок, рекомендація); у вартість реклами вони не входять.",
    },
    organicSocial: {
      last30: social,
      prev30: socialPrev,
      followers: { instagram: fol.ig?.followers ?? null, facebook: fol.fb?.followers ?? null },
    },
    competitorsInstagram: rivals.map((c) => ({
      name: c.name,
      isIsto: c.isOwn,
      followers: c.followers,
      followerGrowth30d: c.growth,
      postsLast30: c.posts,
      postsPerWeek: r2(c.perWeek),
      avgLikes: r0(c.avgLikes),
      avgComments: r2(c.avgComments),
      engagementRatePct: c.er === null ? null : Math.round(c.er * 10000) / 100,
      reelsSharePct: pct(c.reelsShare),
      runsMetaAds: c.adLibraryPageIds.length > 0 ? "є сторінка в Ad Library" : "не знайдено в Ad Library",
    })),
  };
}

export type Snapshot = Awaited<ReturnType<typeof buildSnapshot>>;
