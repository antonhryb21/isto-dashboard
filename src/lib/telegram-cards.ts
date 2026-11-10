import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { leadEvents, leadTelegramMessages, users } from "@/db/schema";
import { escapeHtml } from "@/lib/telegram";
import { STATUS_BY_CODE, type StatusCode } from "@/lib/statuses";

/** Token of the lead bot that posts the cards (the n8n bot). Falls back to the digest bot. */
function botToken() {
  return process.env.TELEGRAM_LEADS_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "";
}

export function telegramCardsEnabled() {
  return Boolean(botToken());
}

/** Remember a card the bot posted. Safe to call again for the same message. */
export async function registerTelegramCard(input: {
  leadId: string;
  chatId: string;
  messageId: number;
  baseText: string;
  replyMarkup?: unknown;
}) {
  await db
    .insert(leadTelegramMessages)
    .values({
      leadId: input.leadId,
      chatId: input.chatId,
      messageId: input.messageId,
      baseText: input.baseText,
      replyMarkup: input.replyMarkup ?? null,
    })
    .onConflictDoNothing();
}

const kyiv = (d: Date) =>
  new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(d)
    .replace(",", "");

/** "telegram:@yuliia" → "@yuliia"; an email → the user's name (or the email). */
function authorLabel(author: string | null, names: Map<string, string>) {
  if (!author) return "—";
  if (author.startsWith("telegram:")) return author.slice("telegram:".length);
  if (author === "sheet") return "таблиця";
  if (author === "meta" || author === "import") return author;
  return names.get(author) || author;
}

/**
 * Rebuild every Telegram card of a lead from the stored card text plus all status changes,
 * in the bot's format, and write it back. `skip` is the message the bot has just edited itself.
 */
export async function syncTelegramCards(leadId: string, skip?: { chatId: string; messageId: number }) {
  const token = botToken();
  if (!token) return { updated: 0, skipped: "no bot token" };

  const cards = await db.select().from(leadTelegramMessages).where(eq(leadTelegramMessages.leadId, leadId));
  if (!cards.length) return { updated: 0 };

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

  const blocks = events.map((e) => {
    const label = STATUS_BY_CODE[e.toValue as StatusCode]?.label ?? e.toValue ?? "";
    return [
      `📋 Статус: ${escapeHtml(label)}`,
      `👤 Обновил: ${escapeHtml(authorLabel(e.author, names))}`,
      `🕒 Обновлено: ${kyiv(e.createdAt)}`,
    ].join("\n");
  });

  let updated = 0;
  const errors: string[] = [];
  for (const c of cards) {
    if (skip && skip.chatId === c.chatId && skip.messageId === c.messageId) continue;
    const text = [c.baseText, ...blocks].join("\n\n");
    const res = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: c.chatId,
        message_id: c.messageId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...(c.replyMarkup ? { reply_markup: c.replyMarkup } : {}),
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (body.ok || /not modified/i.test(body.description ?? "")) updated++;
    else errors.push(`${c.chatId}/${c.messageId}: ${body.description ?? res.status}`);
  }
  return { updated, ...(errors.length ? { errors } : {}) };
}
