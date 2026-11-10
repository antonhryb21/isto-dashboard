import "server-only";
import { and, gt, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { upsertMany } from "@/db/upsert";
import { ads, adInsightsDaily, campaigns, socialPosts } from "@/db/schema";
import { META } from "@/lib/config";
import { detectRegion, listRegions } from "@/lib/regions";
import { graph, graphAll } from "./client";

type Action = { action_type: string; value: string };

/** Lead count from an insights `actions` array. Prefers the combined "lead" action. */
export function leadsFromActions(actions?: Action[]): number {
  if (!actions) return 0;
  const pick = (t: string) => actions.find((a) => a.action_type === t);
  const a = pick("lead") ?? pick("onsite_conversion.lead_grouped") ?? pick("leadgen_grouped");
  return a ? Number(a.value) || 0 : 0;
}

const actionValue = (actions: Action[] | undefined, ...types: string[]) => {
  for (const t of types) {
    const a = actions?.find((x) => x.action_type === t);
    if (a) return Number(a.value) || 0;
  }
  return 0;
};

/** Ad engagement counters as Ads Manager shows them. */
export function engagementFromActions(actions?: Action[]) {
  return {
    pageEngagement: actionValue(actions, "page_engagement"),
    postReactions: actionValue(actions, "post_reaction"),
    postComments: actionValue(actions, "comment"),
    postSaves: actionValue(actions, "onsite_conversion.post_save"),
    postShares: actionValue(actions, "post"),
  };
}

const accountCurrency = new Map<string, string>();
async function currencyOf(accountId: string) {
  if (!accountCurrency.has(accountId)) {
    const r = await graph<{ currency?: string }>(`act_${accountId}`, { fields: "currency" });
    accountCurrency.set(accountId, r.currency ?? "AED");
  }
  return accountCurrency.get(accountId)!;
}

type ApiAd = {
  id: string;
  name: string;
  effective_status?: string;
  campaign_id?: string;
  adset?: { id: string; name: string };
  created_time?: string;
  preview_shareable_link?: string;
  creative?: {
    id: string;
    thumbnail_url?: string;
    image_url?: string;
    video_id?: string;
    body?: string;
    title?: string;
    object_type?: string;
    effective_instagram_media_id?: string;
    effective_object_story_id?: string;
    instagram_permalink_url?: string;
  };
};

const AD_FIELDS =
  "id,name,effective_status,campaign_id,adset{id,name},created_time,preview_shareable_link," +
  "creative.thumbnail_width(720).thumbnail_height(720){id,thumbnail_url,image_url,video_id,body,title,object_type," +
  "effective_instagram_media_id,effective_object_story_id,instagram_permalink_url}";

function adRow(a: ApiAd, accountId: string) {
  const cr = a.creative;
  return {
    id: a.id,
    accountId,
    campaignId: a.campaign_id ?? null,
    adsetId: a.adset?.id ?? null,
    adsetName: a.adset?.name ?? null,
    name: a.name,
    status: a.effective_status ?? null,
    createdTime: a.created_time ? new Date(a.created_time) : null,
    creativeId: cr?.id ?? null,
    thumbnailUrl: cr?.thumbnail_url ?? null,
    imageUrl: cr?.image_url ?? null,
    videoId: cr?.video_id ?? null,
    body: cr?.body ?? null,
    title: cr?.title ?? null,
    objectType: cr?.object_type ?? null,
    instagramMediaId: cr?.effective_instagram_media_id ?? null,
    pagePostId: cr?.effective_object_story_id ?? null,
    permalink:
      cr?.instagram_permalink_url ?? (cr?.effective_object_story_id ? `https://www.facebook.com/${cr.effective_object_story_id}` : null),
    previewLink: a.preview_shareable_link ?? null,
    updatedAt: new Date(),
  };
}

/** Campaigns and ads (with creative) for every ISTO ad account. */
export async function syncAdStructure(opts: { all?: boolean } = {}) {
  const allRegions = await listRegions();
  let adCount = 0;

  for (const accountId of META.adAccountIds) {
    const camps = await graphAll<{ id: string; name: string; objective?: string; effective_status?: string }>(
      `act_${accountId}/campaigns`,
      { fields: "id,name,objective,effective_status", limit: 200 },
    );
    await upsertMany(
      campaigns,
      camps.map((c) => ({
        id: c.id,
        accountId,
        name: c.name,
        objective: c.objective ?? null,
        status: c.effective_status ?? null,
        regionCode: detectRegion(allRegions, c.name),
        updatedAt: new Date(),
      })),
      campaigns.id,
      { key: (r) => r.id },
    );

    if (opts.all) {
      const list = await graphAll<ApiAd>(`act_${accountId}/ads`, { fields: AD_FIELDS, limit: 200 });
      adCount += await upsertMany(ads, list.map((a) => adRow(a, accountId)), ads.id, { chunk: 300, key: (r) => r.id });
    }
  }

  // Daily: only ads that were shown in the last 35 days, fetched by id (50 per request). Listing every
  // paused ad with its creative took longer than Vercel's 5-minute limit.
  if (!opts.all) {
    const since = new Date(Date.now() - 35 * 86_400_000).toISOString().slice(0, 10);
    const recent = await db
      .selectDistinct({ id: adInsightsDaily.adId, accountId: adInsightsDaily.accountId })
      .from(adInsightsDaily)
      .where(and(gte(adInsightsDaily.date, since), gt(adInsightsDaily.impressions, 0)));
    const accountOf = new Map(recent.map((r) => [r.id, r.accountId]));
    const ids = [...accountOf.keys()];
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      // One deleted ad fails the whole ?ids= request: then fetch that chunk one by one.
      let got: ApiAd[];
      try {
        got = Object.values(await graph<Record<string, ApiAd>>("", { ids: chunk.join(","), fields: AD_FIELDS }));
      } catch {
        got = [];
        for (const id of chunk) {
          try {
            got.push(await graph<ApiAd>(id, { fields: AD_FIELDS }));
          } catch {
            /* deleted or not accessible: keep what we have */
          }
        }
      }
      adCount += await upsertMany(ads, got.map((a) => adRow(a, accountOf.get(a.id) ?? "")), ads.id, { key: (r) => r.id });
    }
  }

  // Mark organic posts that were promoted with an ad.
  const promoted = await db
    .select({ ig: ads.instagramMediaId, fb: ads.pagePostId })
    .from(ads);
  const ids = [...new Set(promoted.flatMap((p) => [p.ig, p.fb]).filter((x): x is string => !!x))];
  if (ids.length) await db.update(socialPosts).set({ boosted: true }).where(inArray(socialPosts.id, ids));

  return { ads: adCount };
}

/** Daily ad-level metrics for a date range (inclusive, YYYY-MM-DD). */
export async function syncInsights(since: string, until: string) {
  let rows = 0;
  for (const accountId of META.adAccountIds) {
    const currency = await currencyOf(accountId);
    type Row = {
      date_start: string;
      ad_id: string;
      adset_id?: string;
      campaign_id?: string;
      spend?: string;
      impressions?: string;
      reach?: string;
      clicks?: string;
      inline_link_clicks?: string;
      actions?: Action[];
    };
    const data = await graphAll<Row>(`act_${accountId}/insights`, {
      level: "ad",
      time_increment: 1,
      time_range: JSON.stringify({ since, until }),
      fields: "date_start,ad_id,adset_id,campaign_id,spend,impressions,reach,clicks,inline_link_clicks,actions",
      limit: 500,
    });
    const insightRows = data.map((r) => ({
        date: r.date_start,
        adId: r.ad_id,
        accountId,
        campaignId: r.campaign_id ?? null,
        adsetId: r.adset_id ?? null,
        currency,
        spend: r.spend ?? "0",
        impressions: Number(r.impressions ?? 0),
        reach: Number(r.reach ?? 0),
        clicks: Number(r.clicks ?? 0),
        linkClicks: Number(r.inline_link_clicks ?? 0),
        leads: leadsFromActions(r.actions),
        ...engagementFromActions(r.actions),
        updatedAt: new Date(),
    }));
    rows += await upsertMany(adInsightsDaily, insightRows, [adInsightsDaily.date, adInsightsDaily.adId], { key: (r) => `${r.date}|${r.adId}` });
  }
  return { rows };
}

/**
 * Deduplicated reach for a period. Daily reach can't be summed (the same person counts
 * every day), so this asks Meta for the period total. Cached by the caller.
 */
export async function periodReach(since: string, until: string, campaignIds?: string[]): Promise<number> {
  let total = 0;
  for (const accountId of META.adAccountIds) {
    const params: Record<string, string> = {
      level: "account",
      time_range: JSON.stringify({ since, until }),
      fields: "reach",
    };
    if (campaignIds?.length) {
      params.filtering = JSON.stringify([{ field: "campaign.id", operator: "IN", value: campaignIds }]);
    }
    const r = await graph<{ data: { reach?: string }[] }>(`act_${accountId}/insights`, params);
    total += Number(r.data[0]?.reach ?? 0); // accounts don't share audiences in a meaningful way
  }
  return total;
}

export async function lastInsightDate(): Promise<string | null> {
  const [r] = await db.select({ d: sql<string>`max(${adInsightsDaily.date})` }).from(adInsightsDaily);
  return r?.d ?? null;
}
