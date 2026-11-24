import "server-only";
import { inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { igConversations } from "@/db/schema";
import { META } from "@/lib/config";
import { graphAsPage } from "@/lib/meta/client";

type Msg = { id: string; created_time: string; story?: unknown; shares?: unknown };
type Paged<T> = { data: T[]; paging?: { next?: string } };

async function follow<T>(next: string): Promise<Paged<T>> {
  const res = await fetch(next, { cache: "no-store" });
  return (await res.json()) as Paged<T>;
}

/**
 * Records Instagram direct conversations updated in the last `days`, with the time of their first message.
 * Needs the instagram_manage_messages permission and "Allow access to messages" in the Instagram app.
 */
export async function syncIgConversations(days = 40) {
  const cutoff = Date.now() - days * 86_400_000;
  const seen: { id: string; updated_time: string }[] = [];
  let page = await graphAsPage<Paged<{ id: string; updated_time: string }>>(`${META.pageId}/conversations`, {
    platform: "instagram",
    fields: "id,updated_time",
    limit: 100,
  });
  // Conversations come newest first: stop at the first one older than the window.
  for (;;) {
    const fresh = page.data.filter((c) => Date.parse(c.updated_time) >= cutoff);
    seen.push(...fresh);
    if (fresh.length < page.data.length || !page.paging?.next || seen.length > 5000) break;
    page = await follow(page.paging.next);
  }
  if (!seen.length) return { conversations: 0, added: 0 };

  const known = new Set(
    (await db.select({ id: igConversations.id }).from(igConversations).where(inArray(igConversations.id, seen.map((c) => c.id)))).map((r) => r.id),
  );
  let added = 0;
  for (const c of seen) {
    if (known.has(c.id)) continue;
    // Messages come newest first; walk to the oldest (a few pages at most for a normal thread).
    let msgs = await graphAsPage<Paged<Msg>>(`${c.id}/messages`, { fields: "id,created_time,story,shares", limit: 100 });
    let oldest = msgs.data[msgs.data.length - 1];
    let pages = 1;
    while (msgs.paging?.next && pages < 10) {
      msgs = await follow<Msg>(msgs.paging.next);
      if (msgs.data.length) oldest = msgs.data[msgs.data.length - 1];
      pages++;
    }
    if (!oldest) continue;
    await db
      .insert(igConversations)
      .values({
        id: c.id,
        startedAt: new Date(oldest.created_time),
        fromContent: Boolean(oldest.story || oldest.shares),
        partial: Boolean(msgs.paging?.next),
      })
      .onConflictDoNothing();
    added++;
  }
  return { conversations: seen.length, added };
}

/** New direct contacts and how many of them came from content, for a month ["2026-11-01", "2026-12-01"). */
export async function directForMonth(fromIso: string, toIso: string) {
  const [any] = await db.select({ n: sql<number>`count(*)::int` }).from(igConversations);
  if (!any?.n) return null; // never synced (no permission yet): leave the month empty rather than show 0
  const [r] = await db
    .select({
      total: sql<number>`count(*)::int`,
      content: sql<number>`count(*) filter (where ${igConversations.fromContent})::int`,
    })
    .from(igConversations)
    .where(sql`${igConversations.startedAt} >= ${fromIso}::timestamptz and ${igConversations.startedAt} < ${toIso}::timestamptz`);
  return { directNew: r?.total ?? 0, directFromContent: r?.content ?? 0 };
}
