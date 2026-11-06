const nf = (d = 0) => new Intl.NumberFormat("uk-UA", { maximumFractionDigits: d, minimumFractionDigits: d });

export const fmtInt = (n: number) => nf(0).format(Math.round(n));
export const fmtMoney = (n: number, cur = "AED", d = 0) => `${nf(d).format(n)} ${cur}`;
export const fmtPct = (n: number, d = 1) => `${nf(d).format(n * 100)}%`;

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
