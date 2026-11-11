/**
 * Pure helpers for the lead bot's Telegram cards (no database, no network), so they can be tested.
 *
 * A card is the lead text the bot sent, followed by one block per status change:
 *
 *   📋 Статус: Contacted
 *   👤 Обновил: @yuliia
 *   🕒 Обновлено: 11.11.2026 18:20
 */

const STATUS_BLOCK = /\n\n(?:📋|✅) Статус:/;

/** The card text without any status blocks (the bot may send it with blocks already appended). */
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

export type CardStatusChange = { label: string; author: string; at: Date };

/** Full card text: the base text plus one block per status change, oldest first. */
export function buildCardText(baseText: string, changes: CardStatusChange[]) {
  const blocks = changes.map((c) =>
    [`📋 Статус: ${htmlEscape(c.label)}`, `👤 Обновил: ${htmlEscape(c.author)}`, `🕒 Обновлено: ${cardTime(c.at)}`].join("\n"),
  );
  return [baseText, ...blocks].join("\n\n");
}
