/**
 * Contact details of a lead. Meta's standard fields (full_name, phone_number…) land in their own columns;
 * custom form questions ("Your name", "Ваше ім'я", "Country") end up in `answers`, so they are picked up
 * from there by the question's wording. What is used for contacts is left out of "what they're interested in".
 */
const PATTERNS = {
  name: /(^|\s)(full\s?name|first\s?name|name|ім['ʼ’]?я|прізвище|имя|фио|nume)(\s|$)|your name|ваше ім/i,
  phone: /phone|телефон|номер|whats\s?app|mobile|мобіл|telefon/i,
  email: /e-?mail|пошта|почта|mail/i,
  city: /city|місто|город|location|emirate|area|район|country|країна|страна|oraș|oras/i,
} as const;

type LeadLike = {
  fullName: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  answers: Record<string, string>;
};

export function leadContact(l: LeadLike) {
  const used = new Set<string>();
  const fromAnswers = (re: RegExp) => {
    for (const [q, a] of Object.entries(l.answers ?? {})) {
      if (!used.has(q) && a && re.test(q)) {
        used.add(q);
        return a;
      }
    }
    return null;
  };
  // Matching questions are always taken out of "interest", even when the standard field is already filled.
  const name = fromAnswers(PATTERNS.name);
  const phone = fromAnswers(PATTERNS.phone);
  const email = fromAnswers(PATTERNS.email);
  const city = fromAnswers(PATTERNS.city);
  const interest = Object.fromEntries(Object.entries(l.answers ?? {}).filter(([q]) => !used.has(q)));
  return { name: l.fullName || name, phone: l.phone || phone, email: l.email || email, city: l.city || city, interest };
}
