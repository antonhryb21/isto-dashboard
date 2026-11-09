import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { competitorPosts, competitorSnapshots, competitors } from "@/db/schema";
import { META } from "@/lib/config";
import { graph } from "./client";

type Media = {
  id: string;
  caption?: string;
  like_count?: number;
  comments_count?: number;
  media_type?: string;
  media_product_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp: string;
};
type Discovery = {
  business_discovery: {
    id: string;
    username: string;
    name?: string;
    biography?: string;
    website?: string;
    followers_count?: number;
    media_count?: number;
    profile_picture_url?: string;
    media?: { data: Media[]; paging?: { cursors?: { after?: string }; next?: string } };
  };
};

const MEDIA_FIELDS = "id,caption,like_count,comments_count,media_type,media_product_type,media_url,permalink,timestamp";
let thumbnailSupported = true;

function contentType(m: Media) {
  if (m.media_product_type === "REELS") return "reel";
  if (m.media_type === "CAROUSEL_ALBUM") return "carousel";
  if (m.media_type === "VIDEO") return "video";
  return "post";
}

async function discover(username: string, after?: string) {
  const media = (fields: string) => `media${after ? `.after(${after})` : ""}.limit(50){${fields}}`;
  const query = (fields: string) =>
    graph<Discovery>(META.igUserId, {
      fields: `business_discovery.username(${username}){id,username,name,biography,website,followers_count,media_count,profile_picture_url,${media(fields)}}`,
    });
  if (thumbnailSupported) {
    try {
      return await query(`${MEDIA_FIELDS},thumbnail_url`);
    } catch (e) {
      // Older API versions reject thumbnail_url here; video posts then show without a preview.
      if (!(e instanceof Error) || !/thumbnail_url/i.test(e.message)) throw e;
      thumbnailSupported = false;
    }
  }
  return query(MEDIA_FIELDS);
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Public Instagram data of every tracked account via Business Discovery (works for business and creator accounts).
 * `pages` × 50 latest posts are refreshed per account: 2 for the daily run, up to 10 for history.
 */
export async function syncCompetitors(pages = 2) {
  const list = await db.select().from(competitors).where(eq(competitors.active, true)).orderBy(asc(competitors.sortOrder));
  const report: Record<string, number | string> = {};
  for (const c of list) {
    try {
      let after: string | undefined;
      let posts = 0;
      for (let page = 0; page < pages; page++) {
        const { business_discovery: d } = await discover(c.username, after);
        if (page === 0) {
          await db
            .update(competitors)
            .set({
              igId: d.id,
              displayName: d.name ?? null,
              biography: d.biography ?? null,
              website: d.website ?? null,
              profilePictureUrl: d.profile_picture_url ?? null,
              followers: d.followers_count ?? null,
              mediaCount: d.media_count ?? null,
              lastSyncedAt: new Date(),
              lastError: null,
            })
            .where(eq(competitors.username, c.username));
          const snap = { followers: d.followers_count ?? null, mediaCount: d.media_count ?? null };
          await db
            .insert(competitorSnapshots)
            .values({ username: c.username, date: today(), ...snap })
            .onConflictDoUpdate({ target: [competitorSnapshots.username, competitorSnapshots.date], set: snap });
        }
        for (const m of d.media?.data ?? []) {
          const values = {
            id: m.id,
            username: c.username,
            contentType: contentType(m),
            caption: m.caption ?? null,
            mediaUrl: m.media_url ?? null,
            thumbnailUrl: m.thumbnail_url ?? (m.media_type === "VIDEO" ? null : (m.media_url ?? null)),
            permalink: m.permalink ?? null,
            publishedAt: new Date(m.timestamp),
            likes: m.like_count ?? null,
            comments: m.comments_count ?? null,
            updatedAt: new Date(),
          };
          await db.insert(competitorPosts).values(values).onConflictDoUpdate({ target: competitorPosts.id, set: values });
          posts++;
        }
        after = d.media?.paging?.next ? d.media.paging.cursors?.after : undefined;
        if (!after) break;
      }
      report[c.username] = posts;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      report[c.username] = `error: ${message}`;
      await db.update(competitors).set({ lastError: message }).where(eq(competitors.username, c.username));
    }
  }
  return report;
}
