/** Revenue comparable with spend (same currency or no currency set) and ROMI = (revenue − spend) ÷ spend. */
export function romiMath(spend: number, currency: string, byCurrency: Record<string, number>) {
  const revenue = (byCurrency[currency] ?? 0) + (byCurrency[""] ?? 0);
  const otherCurrency = Object.keys(byCurrency).some((c) => c && c !== currency);
  return { revenue, otherCurrency, romi: revenue && spend ? (revenue - spend) / spend : null };
}
