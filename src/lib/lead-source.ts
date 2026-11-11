/**
 * Where a lead came from. Meta fills "ig" / "fb" itself; the rest are picked by hand
 * when someone adds a lead in the CRM (a call, a referral, a message).
 */
export const LEAD_PLATFORMS = [
  { code: "ig", label: "Instagram" },
  { code: "fb", label: "Facebook" },
  { code: "whatsapp", label: "WhatsApp" },
  { code: "website", label: "Сайт" },
  { code: "call", label: "Дзвінок" },
  { code: "referral", label: "Рекомендація" },
  { code: "other", label: "Інше" },
] as const;

const BY_CODE = Object.fromEntries(LEAD_PLATFORMS.map((p) => [p.code, p.label]));

export function platformLabel(platform: string | null | undefined) {
  if (!platform) return null;
  return BY_CODE[platform] ?? platform;
}

/**
 * Last digits of a phone number, for spotting the same person behind differently written numbers
 * (+971 55 998 48 42 and 0559984842). Null when there are too few digits to compare.
 */
export function phoneKey(phone: string | null | undefined) {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : null;
}

/** The question a hand-typed interest is stored under, so it shows up like a form answer. */
export const INTEREST_QUESTION = "Що цікавить";
