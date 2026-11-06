export type Filters = {
  from: string; // YYYY-MM-DD inclusive
  to: string;
  prevFrom: string;
  prevTo: string;
  preset: string;
  region: string | null;
  platform: string | null; // fb | ig
  campaign: string | null;
  type: string | null; // post | reel | carousel | video
  q: string | null;
};

type SP = Record<string, string | string[] | undefined>;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(Date.parse(s + "T00:00:00Z") + n * 86_400_000));

export const PRESETS = [
  { key: "7d", label: "7 днів" },
  { key: "30d", label: "30 днів" },
  { key: "90d", label: "90 днів" },
  { key: "month", label: "Цей місяць" },
  { key: "prev_month", label: "Минулий місяць" },
];

/** Reads URL search params. The previous period has the same length and ends the day before `from`. */
export function parseFilters(sp: SP): Filters {
  const one = (k: string) => {
    const v = sp[k];
    const s = Array.isArray(v) ? v[0] : v;
    return s && s.trim() ? s.trim() : null;
  };
  const today = iso(new Date());
  let preset = one("p") ?? "30d";
  let from: string;
  let to = today;

  const f = one("from");
  const t = one("to");
  if (f && t && /^\d{4}-\d{2}-\d{2}$/.test(f) && /^\d{4}-\d{2}-\d{2}$/.test(t)) {
    from = f <= t ? f : t;
    to = f <= t ? t : f;
    preset = "custom";
  } else if (preset === "month") {
    from = today.slice(0, 8) + "01";
  } else if (preset === "prev_month") {
    const firstThis = today.slice(0, 8) + "01";
    to = addDays(firstThis, -1);
    from = to.slice(0, 8) + "01";
  } else {
    const n = preset === "7d" ? 7 : preset === "90d" ? 90 : 30;
    if (!["7d", "90d"].includes(preset)) preset = "30d";
    from = addDays(today, -(n - 1));
  }

  // Month presets compare with the whole previous month; others with the same number of days before.
  let prevFrom: string;
  let prevTo: string;
  if (preset === "month" || preset === "prev_month") {
    prevTo = addDays(from, -1);
    prevFrom = prevTo.slice(0, 8) + "01";
  } else {
    const len = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
    prevTo = addDays(from, -1);
    prevFrom = addDays(prevTo, -(len - 1));
  }

  return {
    from,
    to,
    prevFrom,
    prevTo,
    preset,
    region: one("region"),
    platform: one("platform"),
    campaign: one("campaign"),
    type: one("type"),
    q: one("q"),
  };
}

export function delta(cur: number, prev: number): number | null {
  if (!prev) return cur ? null : 0;
  return (cur - prev) / prev;
}
