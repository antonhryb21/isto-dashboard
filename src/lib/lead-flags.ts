import { leadContact } from "@/lib/lead-contact";

/**
 * Hints for whoever handles the lead: facts worth a second look before spending time on a call.
 * They never change the status by themselves; the manager decides.
 */
export type LeadFlag = { code: "geo" | "supplier" | "junk"; label: string; hint: string; suggest: "not_relevant" | "supplier" | "spam" };

/** Dial codes expected for a region's leads. Regions without an entry are not checked. */
const REGION_DIAL: Record<string, string[]> = {
  dubai: ["971"],
  romania: ["40"],
};

const DIAL_CODES = ["971", "966", "974", "973", "968", "965", "380", "880", "234", "254", "91", "92", "94", "44", "49", "48", "40", "39", "34", "33", "31", "20", "27", "7", "1"];

const SUPPLIER =
  /\b(supplier|vendor|manufacturer|wholesale|distributor|we (are|offer|provide|supply|aim|can help)|our (company|services|products|factory)|collaborat\w*|partnership)\b|постачальник|пропонуємо|предлагаем|поставщик/i;
const JUNK = /\b(fuck|shit|bitch|asshole|test|asdf|qwerty)\b|хуй|бля/i;

type LeadLike = Parameters<typeof leadContact>[0] & { regionCode: string | null };

export function leadFlags(l: LeadLike): LeadFlag[] {
  const c = leadContact(l);
  const flags: LeadFlag[] = [];

  const raw = (c.phone ?? "").trim();
  const expected = l.regionCode ? REGION_DIAL[l.regionCode] : undefined;
  if (expected && /^(\+|00)/.test(raw)) {
    const digits = raw.replace(/\D/g, "").replace(/^00/, "");
    if (digits.length >= 9 && !expected.some((code) => digits.startsWith(code))) {
      const code = DIAL_CODES.find((d) => digits.startsWith(d));
      flags.push({
        code: "geo",
        label: code ? `номер +${code}` : "номер не з регіону",
        hint: "Телефон не з країни, на яку налаштована кампанія. Варто уточнити, чи людина в регіоні.",
        suggest: "not_relevant",
      });
    }
  }

  const text = [c.name, c.city, ...Object.values(l.answers ?? {})].filter(Boolean).join(" \n ");
  if (SUPPLIER.test(text)) {
    flags.push({ code: "supplier", label: "схоже на постачальника", hint: "У відповідях людина пропонує власні послуги або товари.", suggest: "supplier" });
  }
  if (JUNK.test(text) || (c.city !== null && c.city.trim().length > 0 && c.city.trim().length < 3)) {
    flags.push({ code: "junk", label: "сумнівні дані", hint: "У формі випадковий текст або лайка замість відповіді.", suggest: "spam" });
  }
  return flags;
}
