import Link from "next/link";
import { requireUser, hasRole } from "@/lib/auth/current-user";
import { loadSmm } from "@/lib/smm";
import {
  MANUAL_FIELDS,
  SMM_GOALS,
  change,
  cpl,
  cr,
  erFollowers,
  erReach,
  highlights,
  monthLabel,
  monthShort,
  n,
  net,
  posts,
  totals,
  type SmmData,
  type SmmRow,
  type SmmTotals,
} from "@/lib/smm-calc";
import { fmtInt, fmtMoney, fmtPct } from "@/lib/format";
import { SectionTitle, Empty } from "@/components/kpi";
import { CsvButton } from "@/components/csv-button";
import { MonthlyChart } from "@/components/charts";
import { ReportSwitcher, SmmManualForm, SmmRefreshButton } from "@/components/smm-controls";

type SP = Promise<Record<string, string | string[] | undefined>>;

const dash = "—";
const int = (v: number | null | undefined) => (typeof v === "number" ? fmtInt(v) : dash);
const pct = (v: number | null, d = 2) => (v === null ? dash : fmtPct(v, d));
const aed = (v: number | null | undefined) => (typeof v === "number" ? fmtMoney(v) : dash);

/** A column of a section table: how to read it from a month and from a year's totals. */
type Col = {
  label: string;
  month: (d: SmmData) => number | null;
  total?: (t: SmmTotals) => number | null;
  fmt?: (v: number | null) => string;
  /** Show ▲/▼ against the previous month; "down" when a fall is good (cost per lead). */
  trend?: "up" | "down";
  /** Which stored field's correction note belongs to this column. */
  note?: keyof SmmData | "net";
  strong?: boolean;
};

const SECTIONS: { id: string; title: string; sub?: string; cols: Col[] }[] = [
  {
    id: "content",
    title: "Опублікований контент",
    cols: [
      { label: "Каруселі", month: (d) => n(d.carousels), total: (t) => t.carousels },
      { label: "Рілси", month: (d) => n(d.reels), total: (t) => t.reels },
      { label: "Сторіс", month: (d) => n(d.stories), total: (t) => t.stories, note: "stories" },
      { label: "Всього публікацій", month: posts, total: (t) => t.posts, strong: true },
    ],
  },
  {
    id: "reach",
    title: "Перегляди й охоплення",
    sub: "До серпня 2025 Meta не розділяла перегляди на органіку й рекламу: для тих місяців розподіл оцінено (≈) за середньою часткою серпня–грудня 2025 (67,5% реклама).",
    cols: [
      { label: "Органіка", month: (d) => n(d.viewsOrganic), total: (t) => t.viewsOrganic },
      { label: "Реклама", month: (d) => n(d.viewsPaid), total: (t) => t.viewsPaid, note: "viewsPaid" },
      { label: "Всього переглядів", month: (d) => n(d.viewsTotal), total: (t) => t.viewsTotal, note: "viewsTotal", strong: true },
      { label: "Охоплення", month: (d) => n(d.reach), total: (t) => t.reach, note: "reach", trend: "up" },
    ],
  },
  {
    id: "engagement",
    title: "Взаємодії та залучення (ER)",
    sub: "ER by reach = взаємодії ÷ охоплення (природно падає, коли росте рекламне охоплення). ER by followers = взаємодії ÷ підписники. Річний ER — сума взаємодій ÷ сума охоплення, а не середнє відсотків.",
    cols: [
      { label: "Лайки", month: (d) => n(d.likes), total: (t) => t.likes },
      { label: "Коментарі", month: (d) => n(d.comments), total: (t) => t.comments },
      { label: "Збереження", month: (d) => n(d.saves), total: (t) => t.saves },
      { label: "Поширення", month: (d) => n(d.shares), total: (t) => t.shares },
      { label: "Всього", month: (d) => n(d.interactions), total: (t) => t.interactions, note: "interactions", strong: true },
      { label: "ER (reach)", month: erReach, total: (t) => t.erReach, fmt: (v) => pct(v), trend: "up" },
      { label: "ER (followers)", month: erFollowers, total: (t) => t.erFollowers, fmt: (v) => pct(v), trend: "up" },
    ],
  },
  {
    id: "followers",
    title: "Аудиторія: підписники",
    sub: "Чистий приріст — фактична зміна кількості підписників за місяць. Підписки й відписки — як їх рахує Meta; їхня різниця не завжди збігається з фактичною зміною.",
    cols: [
      { label: "Початок", month: (d) => n(d.followersStart) },
      { label: "Кінець", month: (d) => n(d.followersEnd), total: (t) => t.followersEnd, note: "followersEnd" },
      { label: "Підписки", month: (d) => n(d.follows), total: (t) => t.follows },
      { label: "Відписки", month: (d) => n(d.unfollows), total: (t) => t.unfollows },
      { label: "Чистий приріст", month: net, total: (t) => t.net, fmt: (v) => (v === null ? dash : `${v > 0 ? "+" : ""}${fmtInt(v)}`), note: "net", strong: true, trend: "up" },
      { label: "Відвідування профілю", month: (d) => n(d.profileVisits), total: (t) => t.profileVisits, note: "profileVisits" },
    ],
  },
  {
    id: "direct",
    title: "Повідомлення в директ",
    cols: [
      { label: "Нові контакти", month: (d) => n(d.directNew), total: (t) => t.directNew, strong: true, trend: "up", note: "directNew" },
      { label: "З контенту", month: (d) => n(d.directFromContent), total: (t) => t.directFromContent, note: "directFromContent" },
    ],
  },
  {
    id: "leads",
    title: "Ліди та конверсії",
    sub: "Ліди й витрати — з обох рекламних кабінетів Meta (ISTO Design & Implementation і ISTO Promo Insta). CR = ліди ÷ відвідування профілю.",
    cols: [
      { label: "Ліди", month: (d) => n(d.leads), total: (t) => t.leads, note: "leads", strong: true, trend: "up" },
      { label: "Витрати", month: (d) => n(d.spend), total: (t) => t.spend, fmt: aed, note: "spend" },
      { label: "Ціна ліда", month: cpl, total: (t) => t.cpl, fmt: aed, trend: "down", strong: true },
      { label: "CR", month: cr, total: (t) => t.cr, fmt: (v) => pct(v), trend: "up" },
    ],
  },
];

export default async function SmmReportPage({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  const sp = await searchParams;
  const all = await loadSmm();
  const years = [...new Set(all.map((r) => r.month.slice(0, 4)))].sort().reverse();
  const y = typeof sp.y === "string" && (sp.y === "all" || years.includes(sp.y)) ? sp.y : "all";
  const rows = y === "all" ? all : all.filter((r) => r.month.startsWith(y));
  const canEdit = hasRole(user.role, "marketing");

  if (!all.length) {
    return (
      <div className="flex flex-col gap-6">
        <SectionTitle title="SMM-звіт" right={<ReportSwitcher />} />
        <Empty>Даних ще немає.</Empty>
      </div>
    );
  }

  const groups = groupByYear(rows);
  const finished = all.filter((r) => !r.partial);
  const hl = highlights(finished);
  const kpiYear = SMM_GOALS.year;
  const kpiRows = all.filter((r) => r.month.startsWith(String(kpiYear)));
  const prevYearRows = all.filter((r) => r.month.startsWith(String(kpiYear - 1)));

  const csv: string[][] = [];
  for (const s of SECTIONS) {
    csv.push([s.title], ["Місяць", ...s.cols.map((c) => c.label)]);
    for (const r of rows) csv.push([monthLabel(r.month), ...s.cols.map((c) => (c.fmt ?? int)(c.month(r.d)))]);
    csv.push([]);
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle
        title="SMM-звіт"
        sub="Instagram @isto_architecture: контент, охоплення, залучення, підписники, директ і ліди по місяцях."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <ReportSwitcher />
            {canEdit && <SmmRefreshButton />}
            <CsvButton rows={csv} filename={`isto-smm-${y}.csv`} />
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-1 text-[12px] text-faint">
        Період:
        {[{ k: "all", label: "Усі місяці" }, ...years.map((x) => ({ k: x, label: x }))].map((o) => (
          <Link key={o.k} className="chip" data-active={o.k === y} href={o.k === "all" ? "?" : `?y=${o.k}`}>
            {o.label}
          </Link>
        ))}
        <span className="ml-3 flex flex-wrap gap-x-3">
          {[{ id: "summary", title: "Підсумок" }, { id: "kpi", title: "KPI" }, ...SECTIONS, { id: "demo", title: "Демографія" }].map((s) => (
            <a key={s.id} href={`#${s.id}`} className="hover:text-text">
              {s.title}
            </a>
          ))}
        </span>
      </div>

      <section id="summary" className="card p-5">
        <h2 className="text-[16px] font-medium">Підсумок</h2>
        <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-5 text-[13.5px] text-muted">
          {hl.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      </section>

      <KpiTable year={kpiYear} rows={kpiRows} prev={prevYearRows} />

      {SECTIONS.map((s) => (
        <section key={s.id} id={s.id} className="card flex flex-col gap-4 p-5">
          <div>
            <h2 className="text-[16px] font-medium">{s.title}</h2>
            {s.sub && <p className="mt-1 text-[12.5px] text-faint">{s.sub}</p>}
          </div>
          <SectionChart id={s.id} rows={rows} />
          <SectionTable cols={s.cols} groups={groups} />
        </section>
      ))}

      <Demographics rows={all} />

      {canEdit && (
        <section className="card flex flex-col gap-3 p-5">
          <div>
            <h2 className="text-[16px] font-medium">Ручні дані</h2>
            <p className="mt-1 text-[12.5px] text-faint">
              Те, чого Meta не віддає через API: повідомлення в директ, відвідування профілю. Вписане тут має перевагу над даними з Meta і позначене ✎.
            </p>
          </div>
          <SmmManualForm
            months={[...all].reverse().map((r) => ({ value: r.month, label: monthLabel(r.month) }))}
            fields={MANUAL_FIELDS}
            values={Object.fromEntries(all.map((r) => [r.month, r.d as Partial<Record<keyof SmmData, number>>]))}
            manual={Object.fromEntries(all.map((r) => [r.month, r.manual]))}
          />
        </section>
      )}

      <div className="flex flex-col gap-1 text-[12px] text-faint">
        <p>
          Історія за січень 2025 — жовтень 2026 перенесена зі звіту в Notion і звірена з рекламними кабінетами Meta. Де цифру виправлено, біля неї стоїть
          крапка <span style={{ color: "var(--data-2)" }}>●</span>: наведіть курсор, щоб побачити, що було у звіті і чому змінено. З листопада 2026 місяці
          заповнюються з Meta автоматично щодня; поточний місяць позначено «в процесі».
        </p>
      </div>
    </div>
  );
}

function groupByYear(rows: SmmRow[]) {
  const out: { year: string; rows: SmmRow[] }[] = [];
  for (const r of rows) {
    const yr = r.month.slice(0, 4);
    if (out[out.length - 1]?.year !== yr) out.push({ year: yr, rows: [] });
    out[out.length - 1].rows.push(r);
  }
  return out;
}

function Note({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <span className="ml-1 cursor-help text-[10px]" style={{ color: "var(--data-2)" }} title={text}>
      ●
    </span>
  );
}

function Trend({ cur, prev, kind }: { cur: number | null; prev: number | null; kind?: "up" | "down" }) {
  if (!kind) return null;
  const c = change(cur, prev);
  if (c === null || c === 0) return null;
  const good = kind === "up" ? c > 0 : c < 0;
  return (
    <span className={`ml-1.5 text-[11px] ${good ? "text-good" : "text-bad"}`} title={`${c > 0 ? "+" : ""}${fmtPct(c, 1)} до попереднього місяця`}>
      {c > 0 ? "▲" : "▼"}
    </span>
  );
}

function SectionTable({ cols, groups }: { cols: Col[]; groups: { year: string; rows: SmmRow[] }[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="data">
        <thead>
          <tr>
            <th>Місяць</th>
            {cols.map((c) => (
              <th key={c.label} className="num">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const t = totals(g.rows);
            return [
              ...g.rows.map((r, i) => {
                const prev = i > 0 ? g.rows[i - 1] : null;
                return (
                  <tr key={r.month}>
                    <td className="whitespace-nowrap">
                      {monthLabel(r.month)}
                      {r.partial && <span className="ml-1.5 text-[11px] text-faint">в процесі</span>}
                    </td>
                    {cols.map((c) => {
                      const v = c.month(r.d);
                      const est = r.d.viewsEstimated && (c.label === "Органіка" || c.label === "Реклама");
                      const manual = c.note && r.manual.includes(String(c.note));
                      return (
                        <td key={c.label} className={`num metric whitespace-nowrap ${c.strong ? "font-medium" : ""}`}>
                          {est && v !== null ? "≈ " : ""}
                          {(c.fmt ?? int)(v)}
                          {manual && <span className="ml-1 text-[10px] text-faint" title="Вписано вручну">✎</span>}
                          <Trend cur={v} prev={prev ? c.month(prev.d) : null} kind={r.partial ? undefined : c.trend} />
                          <Note text={c.note ? r.notes[c.note] : undefined} />
                        </td>
                      );
                    })}
                  </tr>
                );
              }),
              <tr key={`${g.year}-total`} className="bg-panel-2">
                <td className="whitespace-nowrap font-medium">Разом {g.year}</td>
                {cols.map((c) => (
                  <td key={c.label} className="num metric whitespace-nowrap font-medium">
                    {c.total ? (c.fmt ?? int)(c.total(t)) : ""}
                  </td>
                ))}
              </tr>,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

function SectionChart({ id, rows }: { id: string; rows: SmmRow[] }) {
  const data = rows.map((r) => ({
    label: monthShort(r.month),
    net: net(r.d),
    followers: n(r.d.followersEnd),
    organic: n(r.d.viewsOrganic),
    paid: n(r.d.viewsPaid),
    reach: n(r.d.reach),
    erReach: erReach(r.d),
    erFollowers: erFollowers(r.d),
    carousels: n(r.d.carousels),
    reels: n(r.d.reels),
    stories: n(r.d.stories),
    leads: n(r.d.leads),
    cpl: cpl(r.d),
    direct: n(r.d.directNew),
    fromContent: n(r.d.directFromContent),
  }));
  switch (id) {
    case "followers":
      return <MonthlyChart data={data} bars={[{ key: "net", name: "Чистий приріст", color: "good" }]} lines={[{ key: "followers", name: "Підписники", color: "data1", right: true }]} />;
    case "reach":
      return (
        <MonthlyChart
          data={data}
          bars={[
            { key: "organic", name: "Перегляди: органіка", color: "good", stack: "v" },
            { key: "paid", name: "Перегляди: реклама", color: "data1", stack: "v" },
          ]}
          lines={[{ key: "reach", name: "Охоплення", color: "data2" }]}
        />
      );
    case "engagement":
      return (
        <MonthlyChart
          data={data}
          unit="pct"
          rightUnit="pct"
          lines={[
            { key: "erReach", name: "ER by reach", color: "data2" },
            { key: "erFollowers", name: "ER by followers", color: "data1", right: true },
          ]}
        />
      );
    case "content":
      return (
        <MonthlyChart
          data={data}
          bars={[
            { key: "carousels", name: "Каруселі", color: "data1", stack: "c" },
            { key: "reels", name: "Рілси", color: "data2", stack: "c" },
            { key: "stories", name: "Сторіс", color: "sand", stack: "c" },
          ]}
        />
      );
    case "leads":
      return <MonthlyChart data={data} bars={[{ key: "leads", name: "Ліди", color: "data1" }]} lines={[{ key: "cpl", name: "Ціна ліда, AED", color: "data2", right: true }]} rightUnit="aed" />;
    case "direct":
      return (
        <MonthlyChart
          data={data}
          bars={[{ key: "direct", name: "Нові контакти", color: "data1" }]}
          lines={[{ key: "fromContent", name: "З контенту", color: "data2", right: true }]}
        />
      );
    default:
      return null;
  }
}

type Status = { icon: string; text: string; cls: string };

function KpiTable({ year, rows, prev }: { year: number; rows: SmmRow[]; prev: SmmRow[] }) {
  const done = rows.filter((r) => !r.partial);
  const t = totals(done);
  const p = totals(prev);
  const g = SMM_GOALS;
  const months = done.length;
  const lastMonth = done[done.length - 1];
  const period = months ? `${monthShort(done[0].month)} — ${monthShort(lastMonth.month)}` : "";
  // Yearly goals are compared with the pace they need: by October, 10/12 of the goal.
  const pace = (fact: number | null, goal: number): Status => {
    if (fact === null) return { icon: "—", text: "немає даних", cls: "text-faint" };
    if (fact >= goal) return { icon: "✅", text: "досягнуто", cls: "text-good" };
    const need = (goal * months) / 12;
    return fact >= need
      ? { icon: "🔄", text: `у графіку (${fmtInt((fact / goal) * 100)}% цілі)`, cls: "text-muted" }
      : { icon: "⚠️", text: `відстає: ${fmtInt((fact / goal) * 100)}% цілі при ${fmtInt((months / 12) * 100)}% року`, cls: "text-bad" };
  };
  const atMost = (fact: number | null, goal: number): Status =>
    fact === null ? { icon: "—", text: "немає даних", cls: "text-faint" } : fact <= goal ? { icon: "✅", text: "в межах цілі", cls: "text-good" } : { icon: "⚠️", text: "вище цілі", cls: "text-bad" };
  const atLeast = (fact: number | null, goal: number): Status =>
    fact === null ? { icon: "—", text: "немає даних", cls: "text-faint" } : fact >= goal ? { icon: "✅", text: "досягнуто", cls: "text-good" } : { icon: "⚠️", text: "нижче цілі", cls: "text-bad" };

  const lastPosts = lastMonth ? posts(lastMonth.d) : null;
  const followersNeed = g.followers - (t.followersStart ?? 0);
  const left = 12 - months;
  const perMonthNeed = t.followersEnd !== null && left > 0 ? (g.followers - t.followersEnd) / left : null;

  const items: { metric: string; before: string; fact: string; goal: string; status: Status }[] = [
    {
      metric: "Підписники (кінець року)",
      before: int(p.followersEnd),
      fact: int(t.followersEnd),
      goal: fmtInt(g.followers),
      status:
        t.followersEnd !== null && t.followersEnd >= g.followers
          ? { icon: "✅", text: "досягнуто", cls: "text-good" }
          : {
              icon: "⚠️",
              text: perMonthNeed !== null ? `треба +${fmtInt(perMonthNeed)}/міс до кінця року (зараз у середньому +${fmtInt((t.net ?? 0) / Math.max(1, months))})` : "",
              cls: "text-bad",
            },
    },
    { metric: "Чистий приріст підписників", before: plus(p.net), fact: plus(t.net), goal: `+${fmtInt(followersNeed)}`, status: pace(t.net, followersNeed) },
    { metric: "Охоплення (рік)", before: mln(p.reach), fact: mln(t.reach), goal: mln(g.reach), status: pace(t.reach, g.reach) },
    { metric: "Ліди (рік)", before: int(p.leads), fact: int(t.leads), goal: fmtInt(g.leads), status: pace(t.leads, g.leads) },
    { metric: "Ціна ліда", before: aed(p.cpl), fact: aed(t.cpl), goal: `≤ ${fmtMoney(g.cplMax)}`, status: atMost(t.cpl, g.cplMax) },
    { metric: "CR (ліди ÷ відвідування профілю)", before: pct(p.cr), fact: pct(t.cr), goal: `≥ ${fmtPct(g.crMin, 1)}`, status: atLeast(t.cr, g.crMin) },
    {
      metric: "ER (reach / followers)",
      before: `${pct(p.erReach)} / ${pct(p.erFollowers)}`,
      fact: `${pct(t.erReach)} / ${pct(t.erFollowers)}`,
      goal: `≥ ${fmtPct(g.erReachMin, 2)} / ≥ ${fmtPct(g.erFollowersMin, 1)}`,
      status:
        t.erReach !== null && t.erFollowers !== null
          ? t.erReach >= g.erReachMin && t.erFollowers >= g.erFollowersMin
            ? { icon: "✅", text: "досягнуто", cls: "text-good" }
            : { icon: "⚠️", text: `${t.erReach >= g.erReachMin ? "reach ✓" : "reach ↓ (через рекламне охоплення)"}, ${t.erFollowers >= g.erFollowersMin ? "followers ✓" : "followers ↓"}`, cls: "text-bad" }
          : { icon: "—", text: "немає даних", cls: "text-faint" },
    },
    { metric: "Директ: нові контакти (рік)", before: int(p.directNew), fact: int(t.directNew), goal: fmtInt(g.direct), status: pace(t.directNew, g.direct) },
    {
      metric: "Публікацій на місяць",
      before: p.posts !== null && p.months ? `≈ ${fmtInt(p.posts / p.months)}` : dash,
      fact: `${int(lastPosts)} (${lastMonth ? monthShort(lastMonth.month) : ""})`,
      goal: `${g.postsMin}–${g.postsMax}`,
      status: lastPosts === null ? { icon: "—", text: "", cls: "" } : atLeast(lastPosts, g.postsMin),
    },
    {
      metric: "Каруселі на місяць",
      before: p.carousels !== null && p.months ? `≈ ${(p.carousels / p.months).toFixed(1).replace(".", ",")}` : dash,
      fact: `${int(lastMonth ? n(lastMonth.d.carousels) : null)} (${lastMonth ? monthShort(lastMonth.month) : ""})`,
      goal: `${g.carouselsMin}+`,
      status: atLeast(lastMonth ? n(lastMonth.d.carousels) : null, g.carouselsMin),
    },
    {
      metric: "Рілси на місяць",
      before: p.reels !== null && p.months ? `≈ ${(p.reels / p.months).toFixed(1).replace(".", ",")}` : dash,
      fact: `${int(lastMonth ? n(lastMonth.d.reels) : null)} (${lastMonth ? monthShort(lastMonth.month) : ""})`,
      goal: `${g.reelsMin}–${g.reelsMax}`,
      status: atLeast(lastMonth ? n(lastMonth.d.reels) : null, g.reelsMin),
    },
  ];

  return (
    <section id="kpi" className="card flex flex-col gap-3 p-5">
      <div>
        <h2 className="text-[16px] font-medium">KPI SMM {year}</h2>
        <p className="mt-1 text-[12.5px] text-faint">
          Факт — завершені місяці ({period}). Річні цілі порівнюються з темпом: до кінця місяця N має бути виконано N/12 цілі.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="data">
          <thead>
            <tr>
              <th>Метрика</th>
              <th className="num">Факт {year - 1}</th>
              <th className="num">Факт {year}</th>
              <th className="num">Ціль {year}</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.metric}>
                <td>{i.metric}</td>
                <td className="num metric whitespace-nowrap">{i.before}</td>
                <td className="num metric whitespace-nowrap font-medium">{i.fact}</td>
                <td className="num metric whitespace-nowrap">{i.goal}</td>
                <td className={`text-[12.5px] ${i.status.cls}`}>
                  {i.status.icon} {i.status.text}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const plus = (v: number | null) => (v === null ? dash : `${v > 0 ? "+" : ""}${fmtInt(v)}`);
const mln = (v: number | null) => (v === null ? dash : `${(v / 1e6).toFixed(2).replace(".", ",")} млн`);

function Demographics({ rows }: { rows: SmmRow[] }) {
  const withDemo = rows.filter((r) => r.d.cities || r.d.male !== undefined).slice(-8);
  if (!withDemo.length) return null;
  // Largest city first, by the latest snapshot (the database does not keep the order of keys).
  const last = withDemo.findLast((r) => r.d.cities)?.d.cities ?? {};
  const cities = Object.keys(last).sort((a, b) => last[b] - last[a]);
  const cell = (v: number | undefined, prev: number | undefined) => {
    if (v === undefined) return dash;
    const arrow = prev === undefined || prev === v ? "" : v > prev ? " ▲" : " ▼";
    return `${v.toFixed(1).replace(".", ",")}%${arrow}`;
  };
  return (
    <section id="demo" className="card flex flex-col gap-3 p-5">
      <div>
        <h2 className="text-[16px] font-medium">Демографія аудиторії</h2>
        <p className="mt-1 text-[12.5px] text-faint">Частка підписників за містами та статтю на кінець місяця. Instagram показує лише поточний зріз, тому історія — це щомісячні знімки.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="data">
          <thead>
            <tr>
              <th>Показник</th>
              {withDemo.map((r) => (
                <th key={r.month} className="num whitespace-nowrap">
                  {monthShort(r.month)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cities.map((c) => (
              <tr key={c}>
                <td>{c}</td>
                {withDemo.map((r, i) => (
                  <td key={r.month} className="num metric whitespace-nowrap">
                    {cell(r.d.cities?.[c], i ? withDemo[i - 1].d.cities?.[c] : undefined)}
                  </td>
                ))}
              </tr>
            ))}
            {(["male", "female"] as const).map((k) => (
              <tr key={k} className="bg-panel-2">
                <td>{k === "male" ? "Чоловіки" : "Жінки"}</td>
                {withDemo.map((r, i) => (
                  <td key={r.month} className="num metric whitespace-nowrap">
                    {cell(r.d[k], i ? withDemo[i - 1].d[k] : undefined)}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="bg-panel-2">
              <td>Активний час</td>
              {withDemo.map((r) => (
                <td key={r.month} className="num whitespace-nowrap text-[12px]">
                  {r.d.activeTime ?? dash}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
