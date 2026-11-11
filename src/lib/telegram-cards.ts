import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { leadEvents, leadTelegramCards, leads, users } from "@/db/schema";
import { STATUS_BY_CODE, type StatusCode } from "@/lib/statuses";
import { authorLabel, buildCardText, stripStatusBlocks } from "@/lib/telegram-cards-format";

/** Token of the bot that posts the lead cards (the n8n bot). Only that bot can edit its messages. */
function botToken() {
  return process.env.TELEGRAM_LEADS_BOT_TOKEN ?? "";
}

export function telegramCardsEnabled() {
  return Boolean(botToken());
}

/** Remember a card the bot posted. Repeating it for the same message changes nothing. */
export async function registerTelegramCard(input: {
  metaLeadId: string;
  chatId: string;
  messageId: number;
  text: string;
  replyMarkup?: unknown;
}) {
  const baseText = stripStatusBlocks(input.text);
  if (!baseText) return;
  await db
    .insert(leadTelegramCards)
    .values({
      metaLeadId: input.metaLeadId.replace(/^l:/, ""),
      chatId: input.chatId,
      messageId: input.messageId,
      baseText,
      replyMarkup: input.replyMarkup ?? null,
    })
    .onConflictDoNothing();
}

export type CardSyncResult = { updated: number; errors?: string[]; skipped?: string };

/**
 * Rebuild every Telegram card of a lead from its stored text plus the lead's status history,
 * in the bot's format, keeping the buttons. `skip` is the card the bot has just edited itself.
 * Never throws: a Telegram problem must not break a status change.
 */
export async function syncTelegramCards(leadId: string, skip?: { chatId: string; messageId: number }): Promise<CardSyncResult> {
  try {
    const token = botToken();
    if (!token) return { updated: 0, skipped: "TELEGRAM_LEADS_BOT_TOKEN не задано" };

    const [lead] = await db.select({ metaLeadId: leads.metaLeadId }).from(leads).where(eq(leads.id, leadId)).limit(1);
    if (!lead?.metaLeadId) return { updated: 0 };
    const cards = await db.select().from(leadTelegramCards).where(eq(leadTelegramCards.metaLeadId, lead.metaLeadId));
    const targets = cards.filter((c) => !(skip && skip.chatId === c.chatId && skip.messageId === c.messageId));
    if (!targets.length) return { updated: 0 };

    const events = await db
      .select()
      .from(leadEvents)
      .where(and(eq(leadEvents.leadId, leadId), eq(leadEvents.type, "status")))
      .orderBy(asc(leadEvents.createdAt));

    const emails = [...new Set(events.map((e) => e.author).filter((a): a is string => !!a && a.includes("@") && !a.startsWith("telegram:")))];
    const names = new Map<string, string>();
    if (emails.length) {
      for (const u of await db.select({ email: users.email, name: users.name }).from(users).where(inArray(users.email, emails))) {
        if (u.name) names.set(u.email, u.name);
      }
    }
    const changes = events.map((e) => ({
      label: STATUS_BY_CODE[e.toValue as StatusCode]?.label ?? e.toValue ?? "",
      author: authorLabel(e.author, names),
      at: e.createdAt,
    }));

    let updated = 0;
    const errors: string[] = [];
    for (const c of targets) {
      const res = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: c.chatId,
          message_id: c.messageId,
          text: buildCardText(c.baseText, changes),
          parse_mode: "HTML",
          disable_web_page_preview: true,
          ...(c.replyMarkup ? { reply_markup: c.replyMarkup } : {}),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
      if (body.ok || /not modified/i.test(body.description ?? "")) updated++;
      else errors.push(`${c.chatId}/${c.messageId}: ${body.description ?? res.status}`);
    }
    if (errors.length) console.error("telegram card sync", leadId, errors);
    return { updated, ...(errors.length ? { errors } : {}) };
  } catch (e) {
    console.error("telegram card sync failed", leadId, e);
    return { updated: 0, errors: [e instanceof Error ? e.message : String(e)] };
  }
}
