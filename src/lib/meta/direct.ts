import "server-only";
import { inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { igConversations } from "@/db/schema";
import { META } from "@/lib/config";
import { graphAsPage } from "@/lib/meta/client";

type Paged<T> = { data: T[]; paging?: { next?: string }; error?: { message: string } };

async function follow<T>(next: string): Promise<Paged<T>> {
  const res = await fetch(next, { cache: "no-store" });
  const body = (await res.json()) as Paged<T>;
  if (body.error) throw new Error(body.error.message);
  return body;
}

/** Instagram gives only the 20 latest messages of a conversation, so a longer thread's start is unknown. */
const VISIBLE = 20;

/**
 * Records Instagram direct conversations updated in the last `days`, with the time of their first message.
 * Needs the instagram_manage_messages permission and "Allow access to messages" in the Instagram app.
 * Works in small requests (Meta refuses big ones) and stops at `deadline`; the next run continues.
 */
export async function syncIgConversations(days = 40, deadline = Date.now() + 90_000) {
  const cutoff = Date.now() - days * 86_400_000;
  const seen: { id: string; updated_time: string }[] = [];
  let page = await graphAsPage<Paged<{ id: string; updated_time: string }>>(`${META.pageId}/conversations`, {
    platform: "instagram",
    fields: "id,updated_time",
    limit: 25,
  });
  // Conversations come newest first: stop at the first one older than the window.
  for (;;) {
    const fresh = page.data.filter((c) => Date.parse(c.updated_time) >= cutoff);
    seen.push(...fresh);
    if (fresh.length < page.data.length || !page.paging?.next || seen.length > 3000 || Date.now() > deadline) break;
    page = await follow(page.paging.next);
  }
  if (!seen.length) return { conversations: 0, added: 0 };

  const known = new Set(
    (await db.select({ id: igConversations.id }).from(igConversations).where(inArray(igConversations.id, seen.map((c) => c.id)))).map((r) => r.id),
  );
  const todo = seen.filter((c) => !known.has(c.id));
  let added = 0;
  for (const c of todo) {
    if (Date.now() > deadline) break;
    const msgs = await graphAsPage<Paged<{ id: string; created_time: string }>>(`${c.id}/messages`, { fields: "id,created_time", limit: VISIBLE });
    const oldest = msgs.data[msgs.data.length - 1];
    if (!oldest) continue;
    // Did the conversation open with a story reply or a shared post?
    let fromContent = false;
    try {
      const m = await graphAsPage<{ story?: unknown; shares?: unknown }>(oldest.id, { fields: "story,shares" });
      fromContent = Boolean(m.story || m.shares);
    } catch {
      /* older messages may no longer be readable */
    }
    await db
      .insert(igConversations)
      .values({ id: c.id, startedAt: new Date(oldest.created_time), fromContent, partial: msgs.data.length >= VISIBLE })
      .onConflictDoNothing();
    added++;
  }
  return { conversations: seen.length, added, left: todo.length - added };
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
    // A thread with 20+ visible messages may have started long before: it is not counted as a new contact.
    .where(
      sql`${igConversations.startedAt} >= ${fromIso}::timestamptz and ${igConversations.startedAt} < ${toIso}::timestamptz and not ${igConversations.partial}`,
    );
  return { directNew: r?.total ?? 0, directFromContent: r?.content ?? 0 };
}
