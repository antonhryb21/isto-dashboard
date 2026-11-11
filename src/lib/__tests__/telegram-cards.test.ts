import { describe, expect, it } from "vitest";
import { authorLabel, buildCardText, cardTime, stripStatusBlocks } from "@/lib/telegram-cards-format";

const base = "🔥 Новый лид из Meta - DUBAI 🇦🇪\n\n🕒 Создано: 06.11.2026 19:43\n👤 Имя: Rubeena\n📋 Форма: New ShortForm| Dubai";

describe("telegram cards", () => {
  it("strips status blocks the bot already appended", () => {
    const withBlocks = `${base}\n\n📋 Статус: No answer\n👤 Обновил: @a\n🕒 Обновлено: 09.11.2026 16:16`;
    expect(stripStatusBlocks(withBlocks)).toBe(base);
    expect(stripStatusBlocks(`${base}\n\n✅ Статус: Spam`)).toBe(base);
    // "📋 Форма" is part of the card, not a status block.
    expect(stripStatusBlocks(base)).toBe(base);
  });

  it("writes time like the bot, in Kyiv time", () => {
    expect(cardTime(new Date("2026-11-11T16:20:00Z"))).toBe("11.11.2026 18:20");
    expect(cardTime(new Date("2026-07-01T21:05:00Z"))).toBe("02.07.2026 00:05");
  });

  it("labels authors", () => {
    expect(authorLabel("telegram:@yuliia")).toBe("@yuliia");
    expect(authorLabel("max@isto.ae", new Map([["max@isto.ae", "Max"]]))).toBe("Max");
    expect(authorLabel("anna@isto.ae")).toBe("anna@isto.ae");
    expect(authorLabel("sheet")).toBe("таблиця");
  });

  it("builds the card with one block per change", () => {
    const text = buildCardText(base, [
      { label: "No answer", author: "@a", at: new Date("2026-11-09T14:16:00Z") },
      { label: "Lead (Qualified)", author: "Max <m>", at: new Date("2026-11-11T16:20:00Z") },
    ]);
    expect(text).toBe(
      `${base}\n\n📋 Статус: No answer\n👤 Обновил: @a\n🕒 Обновлено: 09.11.2026 16:16` +
        `\n\n📋 Статус: Lead (Qualified)\n👤 Обновил: Max &lt;m&gt;\n🕒 Обновлено: 11.11.2026 18:20`,
    );
    expect(buildCardText(base, [])).toBe(base);
  });
});
