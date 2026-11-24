/**
 * The SMM report's numbers and the arithmetic on them. Pure functions, shared by the page and tests.
 * Every field may be missing: a month that has no value shows "—" rather than a misleading 0.
 */

export type SmmData = {
  followersStart?: number;
  followersEnd?: number;
  follows?: number;
  unfollows?: number;
  profileVisits?: number;
  viewsTotal?: number;
  viewsOrganic?: number;
  viewsPaid?: number;
  /** Organic/paid split estimated from the total (Meta did not split views before August 2025). */
  viewsEstimated?: boolean;
  reach?: number;
  likes?: number;
  comments?: number;
  saves?: number;
  shares?: number;
  interactions?: number;
  carousels?: number;
  reels?: number;
  stories?: number;
  leads?: number;
  /** What the team's report had, when it differs from the ad account. */
  leadsReported?: number;
  spend?: number;
  directNew?: number;
  directFromContent?: number;
  /** Share of followers by city, in percent. */
  cities?: Record<string, number>;
  male?: number;
  female?: number;
  activeTime?: string;
};

export type SmmField = keyof SmmData;

export type SmmRow = {
  month: string;
  source: "report" | "meta";
  d: SmmData;
  notes: Record<string, string>;
  /** Fields someone typed in by hand. */
  manual: string[];
  /** The month is still running. */
  partial: boolean;
};

/** The SMM goals for the year, as set in the team's report. */
export const SMM_GOALS = {
  year: 2026,
  followers: 150_000,
  reach: 10_000_000,
  leads: 2_500,
  cplMax: 400,
  crMin: 0.012,
  erReachMin: 0.0192,
  erFollowersMin: 0.034,
  direct: 1_500,
  postsMin: 40,
  postsMax: 50,
  carouselsMin: 4,
  reelsMin: 4,
  reelsMax: 6,
};

/** Fields a person may type in on the page (the API cannot give them, or gives them late). */
export const MANUAL_FIELDS: { key: SmmField; label: string }[] = [
  { key: "directNew", label: "Директ: нові контакти" },
  { key: "directFromContent", label: "Директ: з контенту" },
  { key: "profileVisits", label: "Відвідування профілю" },
  { key: "stories", label: "Сторіс" },
  { key: "followersEnd", label: "Підписники на кінець місяця" },
];

const MONTHS = ["Січень", "Лютий", "Березень", "Квітень", "Травень", "Червень", "Липень", "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень"];
const SHORT = ["січ", "лют", "бер", "кві", "тра", "чер", "лип", "сер", "вер", "жов", "лис", "гру"];

export const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
export const monthShort = (m: string) => `${SHORT[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;

export const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const div = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : a / b);

export const net = (d: SmmData) => (n(d.followersEnd) !== null && n(d.followersStart) !== null ? d.followersEnd! - d.followersStart! : null);
export const erReach = (d: SmmData) => div(n(d.interactions), n(d.reach));
export const erFollowers = (d: SmmData) => div(n(d.interactions), n(d.followersEnd));
/** Leads per profile visit: the way the team's report counts CR. */
export const cr = (d: SmmData) => div(n(d.leads), n(d.profileVisits));
export const cpl = (d: SmmData) => div(n(d.spend), n(d.leads));
export const posts = (d: SmmData) => {
  const parts = [d.carousels, d.reels, d.stories].map(n);
  return parts.every((x) => x === null) ? null : parts.reduce<number>((s, x) => s + (x ?? 0), 0);
};

/** Change vs the month before, as a fraction; null when either side is missing. */
export function change(cur: number | null, prev: number | null) {
  if (cur === null || prev === null || prev === 0) return null;
  return (cur - prev) / prev;
}

/** Sum of a field over rows, null when no row has it. */
export function sum(rows: SmmRow[], f: (d: SmmData) => number | null | undefined) {
  let s = 0;
  let any = false;
  for (const r of rows) {
    const v = f(r.d);
    if (typeof v === "number" && Number.isFinite(v)) {
      s += v;
      any = true;
    }
  }
  return any ? s : null;
}

/** Totals for a set of months (a year). Ratios are weighted: total interactions over total reach, not an average of percentages. */
export function totals(rows: SmmRow[]) {
  const withEr = rows.filter((r) => n(r.d.interactions) !== null && n(r.d.reach) !== null);
  const withErF = rows.filter((r) => n(r.d.interactions) !== null && n(r.d.followersEnd) !== null);
  const withCr = rows.filter((r) => n(r.d.leads) !== null && n(r.d.profileVisits) !== null);
  const first = rows[0]?.d;
  const last = rows[rows.length - 1]?.d;
  const spend = sum(rows, (d) => d.spend);
  const leads = sum(rows, (d) => d.leads);
  return {
    followersStart: n(first?.followersStart),
    followersEnd: n(last?.followersEnd),
    net: n(last?.followersEnd) !== null && n(first?.followersStart) !== null ? last!.followersEnd! - first!.followersStart! : null,
    follows: sum(rows, (d) => d.follows),
    unfollows: sum(rows, (d) => d.unfollows),
    profileVisits: sum(rows, (d) => d.profileVisits),
    viewsOrganic: sum(rows, (d) => d.viewsOrganic),
    viewsPaid: sum(rows, (d) => d.viewsPaid),
    viewsTotal: sum(rows, (d) => d.viewsTotal),
    reach: sum(rows, (d) => d.reach),
    likes: sum(rows, (d) => d.likes),
    comments: sum(rows, (d) => d.comments),
    saves: sum(rows, (d) => d.saves),
    shares: sum(rows, (d) => d.shares),
    interactions: sum(rows, (d) => d.interactions),
    erReach: div(sum(withEr, (d) => d.interactions), sum(withEr, (d) => d.reach)),
    erFollowers: div(sum(withErF, (d) => d.interactions), sum(withErF, (d) => d.followersEnd)),
    carousels: sum(rows, (d) => d.carousels),
    reels: sum(rows, (d) => d.reels),
    stories: sum(rows, (d) => d.stories),
    posts: sum(rows, posts),
    leads,
    leadsReported: sum(rows, (d) => d.leadsReported ?? d.leads),
    spend,
    cpl: div(spend, leads),
    cr: div(sum(withCr, (d) => d.leads), sum(withCr, (d) => d.profileVisits)),
    directNew: sum(rows, (d) => d.directNew),
    directFromContent: sum(rows, (d) => d.directFromContent),
    months: rows.length,
  };
}

export type SmmTotals = ReturnType<typeof totals>;

/** The month before "2026-01" is "2025-12". */
export function prevMonth(m: string) {
  const y = Number(m.slice(0, 4));
  const mo = Number(m.slice(5, 7));
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
}

export function nextMonth(m: string) {
  const y = Number(m.slice(0, 4));
  const mo = Number(m.slice(5, 7));
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
}

/** Headline findings, recomputed from the data so they never go stale. */
export function highlights(rows: SmmRow[]) {
  const done = rows.filter((r) => !r.partial);
  if (!done.length) return [];
  const out: string[] = [];
  const fmt = (v: number) => new Intl.NumberFormat("uk-UA").format(Math.round(v));
  const t = totals(done);
  if (t.followersStart !== null && t.followersEnd !== null)
    out.push(
      `За ${done.length} міс. (${monthLabel(done[0].month).toLowerCase()} — ${monthLabel(done[done.length - 1].month).toLowerCase()}) акаунт виріс з ${fmt(t.followersStart)} до ${fmt(t.followersEnd)} підписників: +${fmt(t.net ?? 0)}.`,
    );
  const best = (f: (d: SmmData) => number | null, pool = done) =>
    pool.reduce<SmmRow | null>((b, r) => (f(r.d) !== null && (b === null || f(r.d)! > f(b.d)!) ? r : b), null);
  const bn = best(net);
  if (bn) out.push(`Найбільший приріст підписників: ${monthLabel(bn.month).toLowerCase()}, +${fmt(net(bn.d)!)}.`);
  const bv = best((d) => n(d.viewsTotal));
  const br = best((d) => n(d.reach));
  if (bv && br)
    out.push(
      `Рекорд переглядів: ${monthLabel(bv.month).toLowerCase()} — ${(bv.d.viewsTotal! / 1e6).toFixed(2).replace(".", ",")} млн. Рекорд охоплення: ${monthLabel(br.month).toLowerCase()} — ${(br.d.reach! / 1e6).toFixed(2).replace(".", ",")} млн.`,
    );
  const year = done[done.length - 1].month.slice(0, 4);
  const thisYear = done.filter((r) => r.month.startsWith(year));
  const cheapest = thisYear.reduce<SmmRow | null>((b, r) => (cpl(r.d) !== null && (b === null || cpl(r.d)! < cpl(b.d)!) ? r : b), null);
  const ty = totals(thisYear);
  if (cheapest && ty.cpl !== null)
    out.push(
      `Найнижча ціна ліда у ${year}: ${monthLabel(cheapest.month).toLowerCase()} — ${fmt(cpl(cheapest.d)!)} AED. Середня за ${year}: ${fmt(ty.cpl)} AED (${fmt(ty.leads ?? 0)} лідів, ${fmt(ty.spend ?? 0)} AED).`,
    );
  return out;
}
