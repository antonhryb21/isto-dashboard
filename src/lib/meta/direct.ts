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

/** Meta times out or refuses big conversation pages; ask again with a smaller page. */
const TOO_BIG = /timeout|reduce the amount|temporarily unavailable|unknown error/i;

async function conversationsPage(next: string | null) {
  type C = Paged<{ id: string; updated_time: string }>;
  let lastError: unknown;
  for (const limit of [25, 10, 5]) {
    try {
      if (!next) return await graphAsPage<C>(`${META.pageId}/conversations`, { platform: "instagram", fields: "id,updated_time", limit });
      const url = new URL(next);
      url.searchParams.set("limit", String(limit));
      return await follow<C["data"][number]>(url.toString());
    } catch (e) {
      lastError = e;
      if (!(e instanceof Error && TOO_BIG.test(e.message))) throw e;
    }
  }
  throw lastError;
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
  let page = await conversationsPage(null);
  // Conversations come newest first: stop at the first one older than the window.
  for (;;) {
    const fresh = page.data.filter((c) => Date.parse(c.updated_time) >= cutoff);
    seen.push(...fresh);
    if (fresh.length < page.data.length || !page.paging?.next || seen.length > 3000 || Date.now() > deadline) break;
    try {
      page = await conversationsPage(page.paging.next);
    } catch (e) {
      // Keep what was read so far; the next run starts from the newest again and goes further.
      if (seen.length) break;
      throw e;
    }
  }
  if (!seen.length) return { conversations: 0, added: 0 };

  const known = new Set(
    (await db.select({ id: igConversations.id }).from(igConversations).where(inArray(igConversations.id, seen.map((c) => c.id)))).map((r) => r.id),
  );
  const todo = seen.filter((c) => !known.has(c.id));
  let added = 0;
  for (const c of todo) {
    if (Date.now() > deadline) break;
    let msgs: Paged<{ id: string; created_time: string }>;
    try {
      msgs = await graphAsPage<Paged<{ id: string; created_time: string }>>(`${c.id}/messages`, { fields: "id,created_time", limit: VISIBLE });
    } catch (e) {
      if (e instanceof Error && TOO_BIG.test(e.message)) continue; // try this one again next run
      throw e;
    }
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

/**
 * One person wrote in direct (webhook): look up just their conversation and record when it started.
 * A single small request, so it works even when listing the whole inbox times out.
 */
export async function recordConversationWith(userId: string) {
  const r = await graphAsPage<Paged<{ id: string; messages?: Paged<{ id: string; created_time: string }> }>>(`${META.pageId}/conversations`, {
    platform: "instagram",
    user_id: userId,
    fields: `id,messages.limit(${VISIBLE}){id,created_time}`,
  });
  const conv = r.data[0];
  const msgs = conv?.messages?.data ?? [];
  const oldest = msgs[msgs.length - 1];
  if (!conv || !oldest) return false;
  const [known] = await db.select({ id: igConversations.id }).from(igConversations).where(inArray(igConversations.id, [conv.id]));
  if (known) return false;
  let fromContent = false;
  try {
    const m = await graphAsPage<{ story?: unknown; shares?: unknown }>(oldest.id, { fields: "story,shares" });
    fromContent = Boolean(m.story || m.shares);
  } catch {
    /* not readable: count it as a plain message */
  }
  await db
    .insert(igConversations)
    .values({ id: conv.id, startedAt: new Date(oldest.created_time), fromContent, partial: msgs.length >= VISIBLE })
    .onConflictDoNothing();
  return true;
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
