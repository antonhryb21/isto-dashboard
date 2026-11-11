const nf = (d = 0) => new Intl.NumberFormat("uk-UA", { maximumFractionDigits: d, minimumFractionDigits: d });

export const fmtInt = (n: number) => nf(0).format(Math.round(n));
export const fmtMoney = (n: number, cur = "AED", d = 0) => `${nf(d).format(n)} ${cur}`;
export const fmtPct = (n: number, d = 1) => `${nf(d).format(n * 100)}%`;

/**
 * Percent that stays readable when the value is tiny: a fixed 2 decimals turns +2 followers
 * out of 138 000 into a meaningless "0,00%". Keeps about two meaningful digits instead.
 */
export const fmtPctAuto = (n: number) => fmtPctValue(n * 100);

/** Same, for a number that is already in percent units (0.15 means 0.15%). */
export function fmtPctValue(v: number) {
  if (!v) return "0%";
  const abs = Math.abs(v);
  const d = abs >= 10 ? 0 : abs >= 1 ? 1 : abs >= 0.1 ? 2 : abs >= 0.01 ? 3 : 4;
  // Even four decimals can round to nothing; say "about zero" instead of a row of zeros.
  if (Number(abs.toFixed(d)) === 0) return "≈0%";
  // No trailing zeros here: "0,003%" reads better than "0,0030%".
  return `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: d }).format(v)}%`;
}

export function fmtCompact(n: number) {
  if (Math.abs(n) >= 1_000_000) return `${nf(1).format(n / 1_000_000)} млн`;
  if (Math.abs(n) >= 10_000) return `${nf(1).format(n / 1000)} тис`;
  return fmtInt(n);
}

export function fmtDate(d: Date | string, withTime = false) {
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("uk-UA", {
    day: "2-digit",
    month: "short",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    timeZone: "Europe/Kyiv",
  }).format(date);
}

export function fmtMinutes(m: number | null) {
  if (m === null) return "—";
  if (m < 60) return `${Math.round(m)} хв`;
  if (m < 60 * 24) return `${nf(1).format(m / 60)} год`;
  return `${nf(1).format(m / 1440)} дн`;
}

export function ago(d: Date | null | undefined) {
  if (!d) return "ніколи";
  const m = Math.round((Date.now() - d.getTime()) / 60000);
  if (m < 1) return "щойно";
  if (m < 60) return `${m} хв тому`;
  if (m < 1440) return `${Math.round(m / 60)} год тому`;
  return `${Math.round(m / 1440)} дн тому`;
}

/** Ukrainian plural: plural(2, ["лід", "ліди", "лідів"]) → "ліди". */
export function plural(n: number, [one, few, many]: [string, string, string]) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** "13 жовт. – 11 лист. 2026" for a pair of YYYY-MM-DD dates. */
export function fmtRange(from: string, to: string) {
  const f = (d: string, year: boolean) =>
    new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" }).format(new Date(d + "T00:00:00Z")).replace(" р.", "");
  if (from === to) return f(to, true);
  return `${f(from, from.slice(0, 4) !== to.slice(0, 4))} – ${f(to, true)}`;
}
