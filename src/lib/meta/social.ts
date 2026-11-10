import "server-only";
import { localDate } from "@/lib/dates";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { upsertMany } from "@/db/upsert";
import { accountSnapshots, ads, socialPosts, socialPostSnapshots } from "@/db/schema";
import { META } from "@/lib/config";
import { graph, graphAll, graphAsPage, graphAllAsPage, MetaError } from "./client";

const today = () => localDate();

type Metrics = Partial<
  Record<"reach" | "saves" | "shares" | "views" | "likes" | "comments" | "profileVisits" | "follows" | "totalInteractions", number>
>;

/**
 * Ask for several insight metrics at once; if Meta rejects the set (a metric is not
 * available for this media type or was deprecated), retry one by one and keep what works.
 */
async function insightsTolerant(
  fetcher: (metric: string) => Promise<{ data: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] }>,
  metrics: string[],
  rejected?: Set<string>,
): Promise<Record<string, number>> {
  const read = (rows: { name: string; values?: { value: number }[]; total_value?: { value: number } }[]) =>
    Object.fromEntries(rows.map((r) => [r.name, Number(r.total_value?.value ?? r.values?.[0]?.value ?? 0)]));
  const ask = rejected ? metrics.filter((m) => !rejected.has(m)) : metrics;
  if (!ask.length) return {};
  try {
    return read((await fetcher(ask.join(","))).data);
  } catch (e) {
    if (!(e instanceof MetaError)) throw e;
    const out: Record<string, number> = {};
    for (const m of ask) {
      try {
        Object.assign(out, read((await fetcher(m)).data));
      } catch {
        // Unavailable (deprecated or not for this media type): not asked again during this run,
        // which used to cost one extra request per metric for every post.
        rejected?.add(m);
      }
    }
    return out;
  }
}

/** Runs `fn` over items with at most `limit` in flight. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Saves posts in bulk; rows are grouped by which metric columns they carry, so missing metrics never overwrite stored ones. */
async function savePosts(rows: Record<string, unknown>[]) {
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const r of rows) {
    const sig = Object.keys(r).sort().join(",");
    groups.set(sig, [...(groups.get(sig) ?? []), r]);
  }
  for (const g of groups.values()) await upsertMany(socialPosts, g as never, socialPosts.id, { key: (r) => String((r as { id: string }).id) });
}

async function saveSnapshots(items: { postId: string; metrics: Metrics }[]) {
  const date = today();
  await upsertMany(
    socialPostSnapshots,
    items.map(({ postId, metrics }) => ({ postId, date, metrics: Object.fromEntries(Object.entries(metrics).map(([k, v]) => [k, v ?? null])) })),
    [socialPostSnapshots.postId, socialPostSnapshots.date],
    { key: (r) => r.postId },
  );
}

// ---------- Instagram ----------

const IG_METRICS: Record<string, string[]> = {
  FEED: ["reach", "saved", "shares", "views", "likes", "comments", "total_interactions", "profile_visits", "follows"],
  REELS: ["reach", "saved", "shares", "views", "likes", "comments", "total_interactions"],
};

type IgMedia = {
  id: string;
  caption?: string;
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  media_product_type?: "FEED" | "REELS" | "STORY" | "AD";
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp: string;
  like_count?: number;
  comments_count?: number;
};

function igContentType(m: IgMedia) {
  if (m.media_product_type === "REELS") return "reel";
  if (m.media_type === "CAROUSEL_ALBUM") return "carousel";
  if (m.media_type === "VIDEO") return "video";
  return "post";
}

/**
 * Refresh all Instagram posts (media URLs expire, so every post is re-listed) and
 * pull insights for posts published within `insightDays`.
 */
export async function syncInstagram(insightDays = 30) {
  const ig = META.igUserId;
  const account = await graph<{ followers_count?: number; media_count?: number }>(ig, {
    fields: "followers_count,media_count",
  });
  await db
    .insert(accountSnapshots)
    .values({ platform: "ig", accountId: ig, date: today(), followers: account.followers_count ?? null, mediaCount: account.media_count ?? null })
    .onConflictDoUpdate({
      target: [accountSnapshots.platform, accountSnapshots.accountId, accountSnapshots.date],
      set: { followers: account.followers_count ?? null, mediaCount: account.media_count ?? null },
    });

  await syncIgNewFollowers(ig);

  const media = await graphAll<IgMedia>(`${ig}/media`, {
    fields: "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count",
    limit: 100,
  });

  const boosted = new Set(
    (await db.select({ id: ads.instagramMediaId }).from(ads)).map((r) => r.id).filter(Boolean) as string[],
  );
  const cutoff = Date.now() - insightDays * 86_400_000;
  const rejected: Record<string, Set<string>> = { FEED: new Set(), REELS: new Set() };
  const snaps: { postId: string; metrics: Metrics }[] = [];

  const rows = await mapLimit(
    media.filter((m) => m.media_product_type !== "STORY"),
    6,
    async (m) => {
      let metrics: Metrics = { likes: m.like_count, comments: m.comments_count };
      if (new Date(m.timestamp).getTime() >= cutoff) {
        const kind = m.media_product_type === "REELS" ? "REELS" : "FEED";
        const raw = await insightsTolerant((metric) => graph(`${m.id}/insights`, { metric }), IG_METRICS[kind], rejected[kind]);
        metrics = {
          reach: raw.reach,
          saves: raw.saved,
          shares: raw.shares,
          views: raw.views,
          likes: raw.likes ?? m.like_count,
          comments: raw.comments ?? m.comments_count,
          profileVisits: raw.profile_visits,
          follows: raw.follows,
          totalInteractions: raw.total_interactions,
        };
        snaps.push({ postId: m.id, metrics });
      }
      // Only metrics we actually received are written, so older posts keep their last known insights.
      return {
        id: m.id,
        platform: "ig",
        accountId: ig,
        contentType: igContentType(m),
        caption: m.caption ?? null,
        mediaUrl: m.media_type === "VIDEO" ? (m.thumbnail_url ?? null) : (m.media_url ?? null),
        thumbnailUrl: m.thumbnail_url ?? m.media_url ?? null,
        permalink: m.permalink ?? null,
        publishedAt: new Date(m.timestamp),
        boosted: boosted.has(m.id),
        updatedAt: new Date(),
        ...definedOnly(metrics),
      };
    },
  );
  await savePosts(rows);
  await saveSnapshots(snaps);
  const withInsights = snaps.length;

  return { posts: media.length, withInsights };
}

// ---------- Facebook Page ----------

type FbPost = {
  id: string;
  message?: string;
  created_time: string;
  permalink_url?: string;
  full_picture?: string;
  status_type?: string;
  attachments?: { data: { media_type?: string; type?: string }[] };
  shares?: { count: number };
  reactions?: { summary?: { total_count: number } };
  comments?: { summary?: { total_count: number } };
};

function fbContentType(p: FbPost) {
  const a = p.attachments?.data?.[0];
  const t = `${a?.media_type ?? ""} ${a?.type ?? ""} ${p.status_type ?? ""}`.toLowerCase();
  if (t.includes("reel")) return "reel";
  if (t.includes("album")) return "carousel";
  if (t.includes("video")) return "video";
  return "post";
}

export async function syncFacebook(insightDays = 30, maxPosts = 300) {
  const pageId = META.pageId;
  const page = await graphAsPage<{ followers_count?: number; fan_count?: number }>(pageId, {
    fields: "followers_count,fan_count",
  });
  const followers = page.followers_count ?? page.fan_count ?? null;
  await db
    .insert(accountSnapshots)
    .values({ platform: "fb", accountId: pageId, date: today(), followers })
    .onConflictDoUpdate({
      target: [accountSnapshots.platform, accountSnapshots.accountId, accountSnapshots.date],
      set: { followers },
    });

  const posts = await graphAllAsPage<FbPost>(
    `${pageId}/posts`,
    {
      fields:
        "id,message,created_time,permalink_url,full_picture,status_type,attachments{media_type,type}," +
        "shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)",
      limit: 50,
    },
    maxPosts,
  );

  const boosted = new Set(
    (await db.select({ id: ads.pagePostId }).from(ads)).map((r) => r.id).filter(Boolean) as string[],
  );
  const cutoff = Date.now() - insightDays * 86_400_000;

  const rejected = new Set<string>();
  const snaps: { postId: string; metrics: Metrics }[] = [];
  const rows = await mapLimit(posts, 6, async (p) => {
    let metrics: Metrics = {
      likes: p.reactions?.summary?.total_count,
      comments: p.comments?.summary?.total_count,
      shares: p.shares?.count ?? 0,
    };
    if (new Date(p.created_time).getTime() >= cutoff) {
      const raw = await insightsTolerant(
        (metric) => graphAsPage(`${p.id}/insights`, { metric }),
        ["post_impressions_unique", "post_media_view", "post_clicks", "post_video_views"],
        rejected,
      );
      metrics = { ...metrics, reach: raw.post_impressions_unique, views: raw.post_media_view ?? raw.post_video_views };
      snaps.push({ postId: p.id, metrics });
    }
    return {
      id: p.id,
      platform: "fb",
      accountId: pageId,
      contentType: fbContentType(p),
      caption: p.message ?? null,
      mediaUrl: p.full_picture ?? null,
      thumbnailUrl: p.full_picture ?? null,
      permalink: p.permalink_url ?? null,
      publishedAt: new Date(p.created_time),
      boosted: boosted.has(p.id),
      updatedAt: new Date(),
      ...definedOnly(metrics),
    };
  });
  await savePosts(rows);
  await saveSnapshots(snaps);
  return { posts: posts.length };
}

function definedOnly(m: Metrics) {
  return Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined && v !== null && !Number.isNaN(v)));
}

export async function postsByIds(ids: string[]) {
  if (!ids.length) return [];
  return db.select().from(socialPosts).where(inArray(socialPosts.id, ids));
}

/**
 * New Instagram followers per day. Meta only gives the last 30 days of this metric,
 * so history builds up from the day the dashboard starts syncing.
 */
async function syncIgNewFollowers(ig: string) {
  const now = Math.floor(Date.now() / 1000);
  type Ins = { data: { name: string; values: { value: number; end_time: string }[] }[] };
  let r: Ins;
  try {
    r = await graph<Ins>(`${ig}/insights`, { metric: "follower_count", period: "day", since: now - 29 * 86400, until: now });
  } catch (e) {
    console.warn("[instagram] follower_count unavailable:", e instanceof Error ? e.message : e);
    return;
  }
  for (const v of r.data[0]?.values ?? []) {
    // end_time marks the end of the day being reported.
    const date = new Date(Date.parse(v.end_time) - 86_400_000).toISOString().slice(0, 10);
    await db
      .insert(accountSnapshots)
      .values({ platform: "ig", accountId: ig, date, newFollowers: v.value })
      .onConflictDoUpdate({
        target: [accountSnapshots.platform, accountSnapshots.accountId, accountSnapshots.date],
        set: { newFollowers: v.value },
      });
  }
}
