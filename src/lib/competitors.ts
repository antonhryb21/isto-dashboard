import "server-only";
import { and, asc, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { competitorPosts, competitorSnapshots, competitors } from "@/db/schema";
import type { Filters } from "@/lib/filters";

const num = (v: unknown) => Number(v ?? 0) || 0;
const start = (d: string) => new Date(d + "T00:00:00Z");
const end = (d: string) => new Date(d + "T23:59:59Z");

export type CompetitorRow = Awaited<ReturnType<typeof competitorTable>>[number];

export async function listCompetitors(includeInactive = false) {
  const q = db.select().from(competitors).orderBy(asc(competitors.sortOrder), asc(competitors.name));
  return includeInactive ? q : q.where(eq(competitors.active, true));
}

/** One row per tracked account with post activity and engagement for the period. */
export async function competitorTable(f: Filters) {
  const days = Math.round((Date.parse(f.to) - Date.parse(f.from)) / 86_400_000) + 1;
  const [list, stats, snaps] = await Promise.all([
    listCompetitors(),
    db
      .select({
        username: competitorPosts.username,
        posts: sql<string>`count(*)`,
        reels: sql<string>`count(*) filter (where ${competitorPosts.contentType} in ('reel','video'))`,
        carousels: sql<string>`count(*) filter (where ${competitorPosts.contentType} = 'carousel')`,
        likes: sql<string>`coalesce(sum(${competitorPosts.likes}),0)`,
        withLikes: sql<string>`count(${competitorPosts.likes})`,
        comments: sql<string>`coalesce(sum(${competitorPosts.comments}),0)`,
      })
      .from(competitorPosts)
      .where(and(gte(competitorPosts.publishedAt, start(f.from)), lte(competitorPosts.publishedAt, end(f.to))))
      .groupBy(competitorPosts.username),
    // Followers at the start (last snapshot on or before `from`, else the first one in the period) and at the end.
    db
      .select({
        username: competitorSnapshots.username,
        date: competitorSnapshots.date,
        followers: competitorSnapshots.followers,
      })
      .from(competitorSnapshots)
      .where(lte(competitorSnapshots.date, f.to))
      .orderBy(asc(competitorSnapshots.date)),
  ]);
  const byUser = Object.fromEntries(stats.map((s) => [s.username, s]));
  return list.map((c) => {
    const s = byUser[c.username];
    const posts = num(s?.posts);
    const likes = num(s?.likes);
    const comments = num(s?.comments);
    const withLikes = num(s?.withLikes);
    const own = snaps.filter((x) => x.username === c.username && x.followers !== null);
    const before = own.filter((x) => x.date <= f.from).at(-1) ?? own.find((x) => x.date >= f.from);
    const after = own.at(-1);
    const measured = Boolean(before && after && after.date > before.date);
    const growth = measured ? (after!.followers ?? 0) - (before!.followers ?? 0) : null;
    // Growth is measured between two snapshots, which may cover less than the chosen period.
    const growthDays = measured ? Math.round((Date.parse(after!.date) - Date.parse(before!.date)) / 86_400_000) : null;
    const followers = after?.followers ?? c.followers ?? null;
    const avgEng = posts ? (likes + comments) / posts : null;
    return {
      ...c,
      followers,
      growth,
      growthPct: growth !== null && before?.followers ? growth / before.followers : null,
      growthFrom: measured ? before!.date : null,
      growthTo: measured ? after!.date : null,
      growthDays,
      posts,
      perWeek: posts / (days / 7),
      reelsShare: posts ? num(s?.reels) / posts : null,
      carouselShare: posts ? num(s?.carousels) / posts : null,
      avgLikes: withLikes ? likes / withLikes : null,
      avgComments: posts ? comments / posts : null,
      hiddenLikes: posts > 0 && withLikes === 0,
      // Engagement rate per post: (likes + comments) / followers.
      er: avgEng !== null && followers ? avgEng / followers : null,
    };
  });
}

/** Growth in % from the first snapshot of the period, by day, for the chart. */
export async function followersSeries(f: Filters, usernames: string[]) {
  const rows = await db
    .select()
    .from(competitorSnapshots)
    .where(and(gte(competitorSnapshots.date, f.from), lte(competitorSnapshots.date, f.to)))
    .orderBy(asc(competitorSnapshots.date));
  const base: Record<string, number> = {};
  const byDate = new Map<string, Record<string, number | string | null>>();
  for (const r of rows) {
    if (!usernames.includes(r.username) || r.followers === null) continue;
    base[r.username] ??= r.followers;
    const row = byDate.get(r.date) ?? { date: r.date };
    row[r.username] = base[r.username] ? Number((((r.followers - base[r.username]) / base[r.username]) * 100).toFixed(3)) : 0;
    byDate.set(r.date, row);
  }
  return [...byDate.values()];
}

export async function topCompetitorPosts(f: Filters, opts: { username?: string | null; type?: string | null; limit?: number } = {}) {
  const w: SQL[] = [gte(competitorPosts.publishedAt, start(f.from)), lte(competitorPosts.publishedAt, end(f.to))];
  if (opts.username) w.push(eq(competitorPosts.username, opts.username));
  if (opts.type) w.push(eq(competitorPosts.contentType, opts.type));
  return db
    .select()
    .from(competitorPosts)
    .innerJoin(competitors, and(eq(competitors.username, competitorPosts.username), eq(competitors.active, true)))
    .where(and(...w))
    .orderBy(desc(sql`coalesce(${competitorPosts.likes},0) + coalesce(${competitorPosts.comments},0)`))
    .limit(opts.limit ?? 24);
}

export function adLibraryUrl(c: { name: string; adLibraryPageIds: string[] }) {
  const base = "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&media_type=all";
  return c.adLibraryPageIds.length
    ? `${base}&search_type=page&view_all_page_id=${c.adLibraryPageIds[0]}`
    : `${base}&search_type=keyword_unordered&q=${encodeURIComponent(c.name)}`;
}
