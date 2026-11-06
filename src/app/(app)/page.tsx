import { Suspense } from "react";
import Link from "next/link";
import { parseFilters } from "@/lib/filters";
import { listRegions } from "@/lib/regions";
import { adDaily, adTotals, campaignOptions, creativeTable, crmTotals, followers, leadsDaily, responseSpeed, socialTotals } from "@/lib/queries";
import { fmtCompact, fmtInt, fmtMinutes, fmtMoney, fmtPct } from "@/lib/format";
import { FilterBar } from "@/components/filter-bar";
import { Kpi, SectionTitle } from "@/components/kpi";
import { SpendLeadsChart } from "@/components/charts";

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function Overview({ searchParams }: { searchParams: SP }) {
  const f = parseFilters(await searchParams);
  const [regions, camps] = await Promise.all([listRegions(), campaignOptions()]);
  const [ad, adPrev, crm, crmPrev, daily, leadDays, social, socialPrev, fol, speed, creatives] = await Promise.all([
    adTotals(f),
    adTotals(f, f.prevFrom, f.prevTo),
    crmTotals(f),
    crmTotals(f, f.prevFrom, f.prevTo),
    adDaily(f),
    leadsDaily(f),
    socialTotals(f),
    socialTotals(f, f.prevFrom, f.prevTo),
    followers(),
    responseSpeed(f),
    creativeTable(f),
  ]);

  const cur = ad.currency;
  const crmLeads = crm.total - crm.junk;
  const crmLeadsPrev = crmPrev.total - crmPrev.junk;
  const cplReal = crmLeads ? ad.spend / crmLeads : 0;
  const cplRealPrev = crmLeadsPrev ? adPrev.spend / crmLeadsPrev : 0;
  const costQualified = crm.qualified ? ad.spend / crm.qualified : 0;
  const costQualifiedPrev = crmPrev.qualified ? adPrev.spend / crmPrev.qualified : 0;

  // Merge spend (ads) and leads (CRM) by day for the chart.
  const byDay = new Map<string, { date: string; spend: number; leads: number; qualified: number }>();
  for (const d of daily) byDay.set(d.date, { date: d.date, spend: d.spend, leads: 0, qualified: 0 });
  for (const d of leadDays) {
    const row = byDay.get(d.date) ?? { date: d.date, spend: 0, leads: 0, qualified: 0 };
    row.leads = d.total;
    row.qualified = d.qualified;
    byDay.set(d.date, row);
  }
  const chart = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  const top = creatives.filter((c) => c.crm.qualified > 0 || c.metaLeads > 0).sort((a, b) => b.crm.qualified - a.crm.qualified || a.cpl - b.cpl).slice(0, 3);

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle
        title="Огляд"
        sub={`${f.from} — ${f.to} · порівняння з ${f.prevFrom} — ${f.prevTo}`}
      />
      <Suspense>
        <FilterBar
          regions={regions.map((r) => ({ value: r.code, label: r.name }))}
          campaigns={camps.map((c) => ({ value: c.id, label: c.name }))}
          showCampaign
        />
      </Suspense>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Витрати" value={fmtMoney(ad.spend, cur)} current={ad.spend} previous={adPrev.spend} />
        <Kpi label="Ліди (без спаму)" value={fmtInt(crmLeads)} current={crmLeads} previous={crmLeadsPrev} hint={`${fmtInt(crm.total)} усього заявок`} />
        <Kpi label="Ціна ліда" value={fmtMoney(cplReal, cur)} current={cplReal} previous={cplRealPrev} goodWhenDown hint={`за Meta: ${fmtMoney(ad.cpl, cur)}`} />
        <Kpi label="Ціна якісного ліда" value={fmtMoney(costQualified, cur)} current={costQualified} previous={costQualifiedPrev} goodWhenDown accent hint={`${fmtInt(crm.qualified)} якісних`} />
        <Kpi label="Зустрічі" value={fmtInt(crm.meetings)} current={crm.meetings} previous={crmPrev.meetings} />
        <Kpi label="Угоди" value={fmtInt(crm.won)} current={crm.won} previous={crmPrev.won} hint={crm.revenue ? fmtMoney(crm.revenue, cur) : undefined} />
        <Kpi label="CTR · CPM" value={fmtPct(ad.ctr, 2)} current={ad.ctr} previous={adPrev.ctr} hint={`CPM ${fmtMoney(ad.cpm, cur, 1)}`} />
        <Kpi
          label="Реакція на ліда"
          value={fmtMinutes(speed.medianMinutes)}
          hint={speed.waiting ? `${speed.waiting} чекають контакту` : "медіана до першого контакту"}
        />
      </div>

      <div className="card p-5">
        <div className="flex items-baseline justify-between">
          <div className="label">Витрати і ліди по днях</div>
          <div className="text-[12px] text-faint">стовпці — витрати, лінії — ліди та якісні ліди з CRM</div>
        </div>
        <div className="mt-3">
          {chart.length ? <SpendLeadsChart data={chart} currency={cur} /> : <p className="py-16 text-center text-sm text-muted">Даних за період ще немає</p>}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-baseline justify-between">
            <div className="label">Найкращі креативи за якісними лідами</div>
            <Link href="/creatives" className="text-[12px] text-accent">усі креативи →</Link>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {top.length === 0 && <p className="text-sm text-muted">Поки немає креативів з лідами за період.</p>}
            {top.map((c) => (
              <div key={c.id} className="rounded-xl border border-line overflow-hidden">
                {c.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.thumbnail} alt="" className="aspect-square w-full object-cover" loading="lazy" />
                ) : (
                  <div className="aspect-square bg-panel-2" />
                )}
                <div className="p-3 text-[12px]">
                  <div className="truncate font-medium text-text">{c.name}</div>
                  <div className="mt-1 text-muted">
                    {c.crm.qualified} якісних · {fmtMoney(c.spend, cur)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="card p-5">
          <div className="flex items-baseline justify-between">
            <div className="label">Соцмережі</div>
            <Link href="/social" className="text-[12px] text-accent">пости →</Link>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-y-3 text-[13px]">
            <dt className="text-muted">Підписники IG</dt>
            <dd className="text-right">{fol.ig?.followers ? fmtInt(fol.ig.followers) : "—"}</dd>
            <dt className="text-muted">Підписники FB</dt>
            <dd className="text-right">{fol.fb?.followers ? fmtInt(fol.fb.followers) : "—"}</dd>
            <dt className="text-muted">Публікацій</dt>
            <dd className="text-right">{fmtInt(social.posts)} <Diff a={social.posts} b={socialPrev.posts} /></dd>
            <dt className="text-muted">Охоплення</dt>
            <dd className="text-right">{fmtCompact(social.reach)} <Diff a={social.reach} b={socialPrev.reach} /></dd>
            <dt className="text-muted">Збереження</dt>
            <dd className="text-right">{fmtInt(social.saves)} <Diff a={social.saves} b={socialPrev.saves} /></dd>
            <dt className="text-muted">Переходи в профіль</dt>
            <dd className="text-right">{fmtInt(social.profileVisits)}</dd>
          </dl>
        </div>
      </div>
    </div>
  );
}

function Diff({ a, b }: { a: number; b: number }) {
  if (!b) return null;
  const d = (a - b) / b;
  return <span className={`ml-1 text-[11px] ${d >= 0 ? "text-good" : "text-bad"}`}>{d >= 0 ? "+" : ""}{Math.round(d * 100)}%</span>;
}
