import Link from "next/link";
import { localDate } from "@/lib/dates";
import { Suspense } from "react";
import { listRegions } from "@/lib/regions";
import { hasPeriod, parseFilters } from "@/lib/filters";
import { FilterBar } from "@/components/filter-bar";
import { GRAINS, MAX_COLUMNS, buckets, crmSince, firstDataYear, reportCurrencies, reportData, type Grain, type ReportCell } from "@/lib/reports";
import { fmtInt, fmtMoney, fmtPct, fmtRange } from "@/lib/format";
import { SectionTitle } from "@/components/kpi";
import { CsvButton } from "@/components/csv-button";

type SP = Promise<Record<string, string | string[] | undefined>>;

type Row = {
  label: string;
  band: "ads" | "crm" | "social" | "followers";
  value: (c: ReportCell, cur: string) => string;
};

const dash = "—";
const ratio = (a: number, b: number) => (b ? a / b : null);

const ROWS: Row[] = [
  { label: "Витрати", band: "ads", value: (c, cur) => fmtMoney(c.spend, cur) },
  { label: "Кліки (усі)", band: "ads", value: (c) => fmtInt(c.clicks) },
  { label: "Покази", band: "ads", value: (c) => fmtInt(c.impressions) },
  { label: "CPC", band: "ads", value: (c, cur) => (ratio(c.spend, c.clicks) === null ? dash : fmtMoney(c.spend / c.clicks, cur, 2)) },
  { label: "CTR", band: "ads", value: (c) => (ratio(c.clicks, c.impressions) === null ? dash : fmtPct(c.clicks / c.impressions, 2)) },
  { label: "CPM", band: "ads", value: (c, cur) => (ratio(c.spend, c.impressions) === null ? dash : fmtMoney((c.spend / c.impressions) * 1000, cur, 1)) },
  { label: "Ліди", band: "ads", value: (c) => fmtInt(c.leads) },
  { label: "CPL (ціна ліда)", band: "ads", value: (c, cur) => (c.leads ? fmtMoney(c.spend / c.leads, cur) : dash) },
  { label: "Ліди в CRM (без спаму)", band: "crm", value: (c) => fmtInt(c.crmLeads) },
  { label: "Якісні ліди", band: "crm", value: (c) => fmtInt(c.qualified) },
  { label: "Ціна якісного ліда", band: "crm", value: (c, cur) => (c.qualified && c.spend ? fmtMoney(c.spend / c.qualified, cur) : dash) },
  { label: "Зустрічі", band: "crm", value: (c) => fmtInt(c.meetings) },
  { label: "Угоди", band: "crm", value: (c) => fmtInt(c.won) },
  { label: "Виручка", band: "crm", value: (c, cur) => (c.revenue ? fmtMoney(c.revenue, cur) : dash) },
  { label: "ROMI", band: "crm", value: (c) => (c.revenue && c.spend ? `${c.revenue > c.spend ? "+" : ""}${Math.round(((c.revenue - c.spend) / c.spend) * 100)}%` : dash) },
  { label: "Взаємодія зі сторінкою", band: "social", value: (c) => fmtInt(c.pageEngagement) },
  { label: "Реакції на пости", band: "social", value: (c) => fmtInt(c.postReactions) },
  { label: "Коментарі", band: "social", value: (c) => fmtInt(c.postComments) },
  { label: "Збереження", band: "social", value: (c) => fmtInt(c.postSaves) },
  { label: "Поширення", band: "social", value: (c) => fmtInt(c.postShares) },
  { label: "Нові підписники Instagram", band: "followers", value: (c) => (c.newFollowers === null ? dash : fmtInt(c.newFollowers)) },
  {
    label: "Ціна підписника IG",
    band: "followers",
    value: (c, cur) => (c.newFollowers ? fmtMoney(c.followerSpend / c.newFollowers, cur) : dash),
  },
];

export default async function ReportsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);
  const grain = (GRAINS.find((g) => g.key === one("g"))?.key ?? "month") as Grain;
  const today = localDate();
  const thisYear = Number(today.slice(0, 4));
  const page = Math.max(0, Number(one("page") ?? 0) || 0);
  const region = one("region");
  const period = hasPeriod(sp) ? parseFilters(sp) : null;

  const [regions, currencies, firstYear, since] = await Promise.all([listRegions(), reportCurrencies(), firstDataYear(), crmSince()]);
  // CRM rows of a column that ends before the first CRM lead have no data: "—", not a misleading 0.
  const cell = (r: Row, c: { key: string; to: string }) => (r.band === "crm" && (!since || c.to < since) ? dash : r.value(cells[c.key], cur));
  const year = Math.min(thisYear, Math.max(firstYear, Number(one("year") ?? thisYear) || thisYear));
  const regionCurrency = region ? regions.find((r) => r.code === region)?.currency : null;
  const cur = (regionCurrency && currencies.includes(regionCurrency) ? regionCurrency : one("cur")) ?? currencies[0] ?? "AED";

  const cols = buckets(grain, today, { page, year, firstYear, range: period ? { from: period.from, to: period.to } : null });
  const capped = Boolean(period) && cols.length >= MAX_COLUMNS;
  const { cells, total } = await reportData(grain, cols, { currency: currencies.length ? cur : null, region });

  const qs = (patch: Record<string, string | number | null>) => {
    const next = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, String(v));
    }
    return `?${next}`;
  };

  const years = Array.from({ length: thisYear - Math.min(firstYear, thisYear) + 1 }, (_, i) => thisYear - i);
  const showTotal = grain !== "year" || cols.length > 1;
  const groupLabel = grain === "year" ? "Роки" : cols[0]?.group === cols[cols.length - 1]?.group ? cols[0]?.group : `${cols[0]?.group}–${cols[cols.length - 1]?.group}`;
  const regionName = region ? regions.find((r) => r.code === region)?.name : "Усі регіони";

  const csv = [
    [groupLabel ?? "", ...cols.map((c) => c.label), ...(showTotal ? ["Разом"] : [])],
    ...ROWS.map((r) => [r.label, ...cols.map((c) => cell(r, c)), ...(showTotal ? [r.value(total, cur)] : [])]),
  ];

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle
        title="Звіти"
        sub="Реклама Meta, взаємодія з дописами та нові підписники за днями, тижнями, місяцями або роками."
        right={<CsvButton rows={csv} filename={`isto-report-${grain}-${cols[0]?.from ?? today}.csv`} />}
      />

      <Suspense>
        <FilterBar
          regions={regions.map((r) => ({ value: r.code, label: r.name }))}
          showPlatform={false}
          autoRange={cols.length ? { from: cols[0].from, to: cols[cols.length - 1].to } : undefined}
        />
      </Suspense>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="text-[12px] text-faint">Розбити по:</span>
        <div className="-ml-3 flex gap-1">
          {GRAINS.map((g) => (
            <Link key={g.key} className="chip" data-active={grain === g.key} href={qs({ g: g.key, page: null })}>
              {g.label}
            </Link>
          ))}
        </div>

        {!period && grain === "month" && years.length > 1 && (
          <div className="flex gap-1">
            {years.map((y) => (
              <Link key={y} className="chip" data-active={year === y} href={qs({ year: y === thisYear ? null : y })}>
                {y}
              </Link>
            ))}
          </div>
        )}

        {!period && (grain === "day" || grain === "week") && (
          <div className="flex items-center gap-1">
            <Link className="chip" href={qs({ page: page + 1 })}>
              ← раніше
            </Link>
            {page > 0 && (
              <Link className="chip" href={qs({ page: page - 1 || null })}>
                пізніше →
              </Link>
            )}
          </div>
        )}

        {currencies.length > 1 && !regionCurrency && (
          <div className="flex items-center gap-1 text-[12px] text-faint">
            Валюта:
            {currencies.map((c) => (
              <Link key={c} className="chip" data-active={cur === c} href={qs({ cur: c })}>
                {c}
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="card overflow-x-auto">
        <table className="data report">
          <thead>
            <tr>
              <th className="sticky-col display !text-[14px] !normal-case !tracking-normal text-text">{groupLabel}</th>
              {cols.map((c) => (
                <th key={c.key} className="num !text-text">
                  {c.label}
                </th>
              ))}
              {showTotal && <th className="num total !text-text">Разом</th>}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.label} className={`band-${r.band}`}>
                <td className="sticky-col">{r.label}</td>
                {cols.map((c) => (
                  <td key={c.key} className="num metric">
                    {cell(r, c)}
                  </td>
                ))}
                {showTotal && <td className="num metric total">{r.value(total, cur)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {capped && <p className="text-[12px] text-bad">Показано перші {MAX_COLUMNS} колонок. Для довгого періоду оберіть більший крок.</p>}

      <div className="flex flex-col gap-1 text-[12px] text-faint">
        <p>
          {regionName}
          {currencies.length > 1 ? ` · суми в ${cur}: рекламні кабінети в різних валютах не додаються між собою` : ""}. CPC і CTR рахуються від усіх
          кліків, як у Ads Manager. «Ліди» — за даними Meta; блок CRM — ліди, створені в цьому періоді, і до якого етапу вони дійшли{since ? `; дані CRM є з ${fmtRange(since, since)}, раніше стоїть «—»` : ""}.
        </p>
        <p>
          Реакції, коментарі, збереження і поширення — взаємодія з рекламними дописами. Нові підписники Instagram — по всьому акаунту; Meta віддає їх лише
          за останні 30 днів, тому історія накопичується з моменту підключення. Ціна підписника = витрати за дні, по яких є дані про підписників ÷ нові підписники.
        </p>
      </div>
    </div>
  );
}
