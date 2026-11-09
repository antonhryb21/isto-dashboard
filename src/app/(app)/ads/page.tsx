import { Suspense } from "react";
import Link from "next/link";
import { parseFilters } from "@/lib/filters";
import { listRegions } from "@/lib/regions";
import { adTotals, campaignTable, withCurrency } from "@/lib/queries";
import { fmtInt, fmtMoney, fmtPct } from "@/lib/format";
import { FilterBar } from "@/components/filter-bar";
import { Empty, Kpi, SectionTitle } from "@/components/kpi";

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function AdsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { f, currencies } = await withCurrency(parseFilters(sp));
  const [regions, rows, ad, adPrev] = await Promise.all([listRegions(), campaignTable(f), adTotals(f), adTotals(f, f.prevFrom, f.prevTo)]);
  const regionName = Object.fromEntries(regions.map((r) => [r.code, r.name]));
  const cur = ad.currency;

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle title="Реклама" sub="Кампанії Meta з результатами в CRM: скільки лідів стали якісними і дійшли до угоди." />
      <Suspense>
        <FilterBar currencies={currencies} currency={f.currency} regions={regions.map((r) => ({ value: r.code, label: r.name }))} showPlatform={false} />
      </Suspense>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Витрати" value={fmtMoney(ad.spend, cur)} current={ad.spend} previous={adPrev.spend} />
        <Kpi label="Покази" value={fmtInt(ad.impressions)} current={ad.impressions} previous={adPrev.impressions} />
        <Kpi label="Кліки" value={fmtInt(ad.linkClicks)} current={ad.linkClicks} previous={adPrev.linkClicks} hint={`CPC ${fmtMoney(ad.cpc, cur, 2)}`} />
        <Kpi label="Ліди (Meta)" value={fmtInt(ad.metaLeads)} current={ad.metaLeads} previous={adPrev.metaLeads} />
        <Kpi label="CPL (Meta)" value={fmtMoney(ad.cpl, cur)} current={ad.cpl} previous={adPrev.cpl} goodWhenDown />
      </div>

      {rows.length === 0 ? (
        <Empty>Даних про рекламу за цей період немає. Якщо це перший запуск, зачекайте першу синхронізацію.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="data">
            <thead>
              <tr>
                <th>Кампанія</th>
                <th>Регіон</th>
                <th className="num">Витрати</th>
                <th className="num">CTR</th>
                <th className="num">Ліди Meta</th>
                <th className="num">CPL</th>
                <th className="num">Ліди CRM</th>
                <th className="num">Якісні</th>
                <th className="num">Ціна якісного</th>
                <th className="num">Угоди</th>
                <th className="num">Виручка</th>
                <th className="num">ROMI</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id ?? r.name}>
                  <td className="max-w-80">
                    <Link
                      href={`/creatives?${new URLSearchParams({ ...flat(sp), campaign: r.id ?? "" })}`}
                      className="hover:text-accent"
                    >
                      {r.name}
                    </Link>
                    {r.status && r.status !== "ACTIVE" && <span className="ml-2 text-[11px] text-faint">{r.status.toLowerCase()}</span>}
                  </td>
                  <td className="text-muted">{r.region ? regionName[r.region] ?? r.region : "—"}</td>
                  <td className="num">{fmtMoney(r.spend, r.currency)}</td>
                  <td className="num">{fmtPct(r.ctr, 2)}</td>
                  <td className="num">{fmtInt(r.metaLeads)}</td>
                  <td className="num">{r.cpl ? fmtMoney(r.cpl, r.currency) : "—"}</td>
                  <td className="num">{fmtInt(r.crm.total)}</td>
                  <td className="num">{fmtInt(r.crm.qualified)}</td>
                  <td className="num text-accent">{r.costPerQualified ? fmtMoney(r.costPerQualified, r.currency) : "—"}</td>
                  <td className="num">{r.crm.won ? fmtInt(r.crm.won) : "—"}</td>
                  <td className="num" title={r.otherCurrency ? "Є угоди в іншій валюті — вони не враховані" : undefined}>
                    {r.revenue ? fmtMoney(r.revenue, r.currency) : "—"}
                    {r.otherCurrency && <span className="text-faint">*</span>}
                  </td>
                  <td className="num"><Romi value={r.romi} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[12px] text-faint">
        «Ліди Meta» — що рахує рекламний кабінет. «Ліди CRM» і «Якісні» — ліди з CRM, створені в цей період, з урахуванням статусів. «Виручка» — сума
        угод (статус Won) з лідів цієї кампанії; ROMI = (виручка − витрати) ÷ витрати. Угоди в іншій валюті, ніж кабінет, не додаються (позначені *).
      </p>
    </div>
  );
}

export function Romi({ value }: { value: number | null }) {
  if (value === null) return <span className="text-faint">—</span>;
  return <span className={value >= 0 ? "text-good" : "text-bad"}>{`${value > 0 ? "+" : ""}${Math.round(value * 100)}%`}</span>;
}

function flat(sp: Record<string, string | string[] | undefined>) {
  return Object.fromEntries(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
}
