import "server-only";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { accountSnapshots, ads, socialPosts, socialPostSnapshots } from "@/db/schema";
import { META } from "@/lib/config";
import { graph, graphAll, graphAsPage, graphAllAsPage, MetaError } from "./client";

const today = () => new Date().toISOString().slice(0, 10);

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
): Promise<Record<string, number>> {
  const read = (rows: { name: string; values?: { value: number }[]; total_value?: { value: number } }[]) =>
    Object.fromEntries(rows.map((r) => [r.name, Number(r.total_value?.value ?? r.values?.[0]?.value ?? 0)]));
  try {
    return read((await fetcher(metrics.join(","))).data);
  } catch (e) {
    if (!(e instanceof MetaError)) throw e;
    const out: Record<string, number> = {};
    for (const m of metrics) {
      try {
        Object.assign(out, read((await fetcher(m)).data));
      } catch {
        /* metric unavailable for this item */
      }
    }
    return out;
  }
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

  const media = await graphAll<IgMedia>(`${ig}/media`, {
    fields: "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count",
    limit: 100,
  });

  const boosted = new Set(
    (await db.select({ id: ads.instagramMediaId }).from(ads)).map((r) => r.id).filter(Boolean) as string[],
  );
  const cutoff = Date.now() - insightDays * 86_400_000;
  let withInsights = 0;

  for (const m of media) {
    if (m.media_product_type === "STORY") continue;
    const isRecent = new Date(m.timestamp).getTime() >= cutoff;
    let metrics: Metrics = { likes: m.like_count, comments: m.comments_count };

    if (isRecent) {
      const raw = await insightsTolerant(
        (metric) => graph(`${m.id}/insights`, { metric }),
        IG_METRICS[m.media_product_type === "REELS" ? "REELS" : "FEED"],
      );
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
      withInsights++;
      await snapshot(m.id, metrics);
    }

    const base = {
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
    };
    // Only overwrite metrics we actually received, so older posts keep their last known insights.
    const metricCols = definedOnly(metrics);
    await db
      .insert(socialPosts)
      .values({ ...base, ...metricCols })
      .onConflictDoUpdate({ target: socialPosts.id, set: { ...base, ...metricCols } });
  }

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

  for (const p of posts) {
    let metrics: Metrics = {
      likes: p.reactions?.summary?.total_count,
      comments: p.comments?.summary?.total_count,
      shares: p.shares?.count ?? 0,
    };
    if (new Date(p.created_time).getTime() >= cutoff) {
      const raw = await insightsTolerant(
        (metric) => graphAsPage(`${p.id}/insights`, { metric }),
        ["post_impressions_unique", "post_media_view", "post_clicks", "post_video_views"],
      );
      metrics = {
        ...metrics,
        reach: raw.post_impressions_unique,
        views: raw.post_media_view ?? raw.post_video_views,
      };
      await snapshot(p.id, metrics);
    }
    const base = {
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
    };
    const metricCols = definedOnly(metrics);
    await db
      .insert(socialPosts)
      .values({ ...base, ...metricCols })
      .onConflictDoUpdate({ target: socialPosts.id, set: { ...base, ...metricCols } });
  }
  return { posts: posts.length };
}

async function snapshot(postId: string, m: Metrics) {
  const metrics = Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v ?? null]));
  await db
    .insert(socialPostSnapshots)
    .values({ postId, date: today(), metrics })
    .onConflictDoUpdate({ target: [socialPostSnapshots.postId, socialPostSnapshots.date], set: { metrics } });
}

function definedOnly(m: Metrics) {
  return Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined && v !== null && !Number.isNaN(v)));
}

export async function postsByIds(ids: string[]) {
  if (!ids.length) return [];
  return db.select().from(socialPosts).where(inArray(socialPosts.id, ids));
}
