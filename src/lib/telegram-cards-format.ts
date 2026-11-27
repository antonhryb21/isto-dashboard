/**
 * Pure helpers for the lead bot's Telegram cards (no database, no network), so they can be tested.
 *
 * A card is the lead text the bot sent, followed by one block per status change or comment, oldest first:
 *
 *   📋 Статус: Contacted
 *   👤 Обновил: @yuliia
 *   🕒 Обновлено: 11.11.2026 18:20
 *
 *   💬 Комментарий: перезвонить в понедельник
 *   👤 Автор: @yuliia
 *   🕒 11.11.2026 18:25
 */

const STATUS_BLOCK = /\n\n(?:(?:📋|✅) Статус:|💬 Комментарий:)/;

/** Telegram refuses message text longer than this. */
const TELEGRAM_TEXT_LIMIT = 4096;
/** A comment is cut to this length on the card; the CRM keeps the whole text. */
const CARD_COMMENT_LIMIT = 800;

/** The card text without any status or comment blocks (the bot may send it with blocks already appended). */
export function stripStatusBlocks(text: string) {
  const m = STATUS_BLOCK.exec(text);
  return (m ? text.slice(0, m.index) : text).trimEnd();
}

const htmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Time as the bot writes it: 11.11.2026 18:20, Kyiv time. */
export function cardTime(d: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Kyiv",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`;
}

/** Who changed the status, as shown on the card: "@nick" for the bot, the CRM user's name otherwise. */
export function authorLabel(author: string | null | undefined, names: Map<string, string> = new Map()) {
  if (!author) return "—";
  if (author.startsWith("telegram:")) return author.slice("telegram:".length) || "—";
  if (author === "sheet" || author === "import") return "таблиця";
  if (author === "meta") return "Meta";
  return names.get(author) || author;
}

export type CardStatusChange = { kind?: "status"; label: string; author: string; at: Date };
export type CardComment = { kind: "comment"; text: string; author: string; at: Date };
export type CardEntry = CardStatusChange | CardComment;

function block(e: CardEntry) {
  if (e.kind === "comment") {
    const text = e.text.trim();
    const cut = text.length > CARD_COMMENT_LIMIT ? `${text.slice(0, CARD_COMMENT_LIMIT).trimEnd()}…` : text;
    return [`💬 Комментарий: ${htmlEscape(cut)}`, `👤 Автор: ${htmlEscape(e.author)}`, `🕒 ${cardTime(e.at)}`].join("\n");
  }
  return [`📋 Статус: ${htmlEscape(e.label)}`, `👤 Обновил: ${htmlEscape(e.author)}`, `🕒 Обновлено: ${cardTime(e.at)}`].join("\n");
}

/**
 * Full card text: the base text plus one block per status change or comment, in the given order.
 * When it would not fit in a Telegram message the oldest blocks are left out (the CRM has them all).
 */
export function buildCardText(baseText: string, entries: CardEntry[]) {
  const blocks = entries.map(block);
  const omitted = "…";
  let start = 0;
  const join = (from: number) => [baseText, ...(from > 0 ? [omitted] : []), ...blocks.slice(from)].join("\n\n");
  while (start < blocks.length && join(start).length > TELEGRAM_TEXT_LIMIT) start++;
  return join(start);
}

type Button = { text?: unknown; callback_data?: unknown; [k: string]: unknown };

/**
 * The card's buttons with the retired Follow-up button turned into Comment (same lead, same form),
 * so cards posted before the change get the new button when the dashboard rewrites them.
 */
export function withCommentButton(replyMarkup: unknown): unknown {
  const rows = (replyMarkup as { inline_keyboard?: unknown } | null)?.inline_keyboard;
  if (!Array.isArray(rows)) return replyMarkup;
  return {
    ...(replyMarkup as object),
    inline_keyboard: rows.map((row) =>
      Array.isArray(row)
        ? row.map((b: Button) =>
            typeof b?.callback_data === "string" && b.callback_data.startsWith("Follow-up|")
              ? { ...b, text: "✍️ Comment", callback_data: `Comment|${b.callback_data.slice("Follow-up|".length)}` }
              : b,
          )
        : row,
    ),
  };
}
