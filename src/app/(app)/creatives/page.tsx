import { Suspense } from "react";
import { Play } from "lucide-react";
import { parseFilters } from "@/lib/filters";
import { listRegions } from "@/lib/regions";
import { campaignOptions, creativeFatigue, creativeTable, withCurrency } from "@/lib/queries";
import { fmtInt, fmtMoney, fmtPct } from "@/lib/format";
import { FilterBar } from "@/components/filter-bar";
import { Empty, SectionTitle } from "@/components/kpi";

type SP = Promise<Record<string, string | string[] | undefined>>;

const SORTS = {
  qualified: { label: "Якісні ліди", fn: (a: Row, b: Row) => b.crm.qualified - a.crm.qualified || b.spend - a.spend },
  spend: { label: "Витрати", fn: (a: Row, b: Row) => b.spend - a.spend },
  cpq: { label: "Ціна якісного ліда", fn: (a: Row, b: Row) => (a.costPerQualified || Infinity) - (b.costPerQualified || Infinity) },
  ctr: { label: "CTR", fn: (a: Row, b: Row) => b.ctr - a.ctr },
  tired: { label: "Спершу втомлені", fn: () => 0 },
  romi: { label: "ROMI", fn: (a: Row, b: Row) => (b.romi ?? -Infinity) - (a.romi ?? -Infinity) || b.revenue - a.revenue },
};
type Row = Awaited<ReturnType<typeof creativeTable>>[number];

export default async function CreativesPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { f, currencies } = await withCurrency(parseFilters(sp));
  const sortKey = (typeof sp.sort === "string" && sp.sort in SORTS ? sp.sort : "qualified") as keyof typeof SORTS;
  const [regions, camps, rowsRaw, fatigue] = await Promise.all([listRegions(), campaignOptions(), creativeTable(f), creativeFatigue(f.to)]);
  const rows =
    sortKey === "tired"
      ? [...rowsRaw].sort((a, b) => Number(!!fatigue.get(b.id)?.tired) - Number(!!fatigue.get(a.id)?.tired) || b.spend - a.spend)
      : [...rowsRaw].sort(SORTS[sortKey].fn);

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle title="Креативи" sub="Кожне оголошення з візуалом, витратами та тим, що сталося з його лідами в CRM." />
      <Suspense>
        <FilterBar currencies={currencies} currency={f.currency}
          regions={regions.map((r) => ({ value: r.code, label: r.name }))}
          campaigns={camps.map((c) => ({ value: c.id, label: c.name }))}
          showPlatform={false}
          showCampaign
          showSearch
          searchPlaceholder="Назва або текст оголошення"
        />
      </Suspense>
      <div className="flex flex-wrap items-center gap-1 text-[12px] text-muted">
        Сортувати:
        {Object.entries(SORTS).map(([k, s]) => (
          <a key={k} className="chip" data-active={k === sortKey} href={`?${new URLSearchParams({ ...flat(sp), sort: k })}`}>
            {s.label}
          </a>
        ))}
      </div>

      {rows.length === 0 ? (
        <Empty>Оголошень з показами за цей період немає.</Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {rows.map((c) => (
            <article key={c.id} className="card overflow-hidden flex flex-col">
              <a href={c.permalink ?? undefined} target="_blank" rel="noreferrer" className="relative block bg-panel-2">
                {c.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.thumbnail} alt="" className="aspect-[4/5] w-full object-cover" loading="lazy" />
                ) : (
                  <div className="aspect-[4/5]" />
                )}
                {c.isVideo && (
                  <span className="absolute right-2 top-2 rounded-full bg-overlay p-1.5">
                    <Play size={12} fill="white" />
                  </span>
                )}
                {fatigue.get(c.id)?.tired && c.status === "ACTIVE" && (
                  <span
                    className="absolute bottom-2 left-2 rounded-full bg-bad px-2 py-0.5 text-[11px] text-white"
                    title="Крутиться 14+ днів, CTR за тиждень упав на 30%+ — час оновити креатив"
                  >
                    втомився
                  </span>
                )}
                {c.status && c.status !== "ACTIVE" && (
                  <span className="absolute left-2 top-2 rounded-full bg-overlay px-2 py-0.5 text-[11px] text-white">
                    {c.status.toLowerCase()}
                  </span>
                )}
              </a>
              <div className="flex flex-1 flex-col p-4">
                <div className="truncate text-[13.5px] font-medium" title={c.name}>
                  {c.name}
                </div>
                <div className="truncate text-[12px] text-faint" title={c.campaignName ?? ""}>
                  {c.campaignName}
                </div>
                {c.body && <p className="mt-2 line-clamp-2 text-[12px] text-muted">{c.body}</p>}
                {(() => {
                  const fa = fatigue.get(c.id);
                  if (!fa || fa.ctr7 === null) return null;
                  return (
                    <div className="mt-2 flex flex-wrap gap-x-3 text-[11.5px] text-faint">
                      <span>{fa.daysRunning} дн у показі</span>
                      {fa.ctrChange !== null && (
                        <span className={fa.ctrChange <= -0.3 ? "text-bad" : fa.ctrChange >= 0.1 ? "text-good" : ""}>
                          CTR за тиждень {fa.ctrChange > 0 ? "▲" : "▼"} {fmtPct(Math.abs(fa.ctrChange), 0)}
                        </span>
                      )}
                      {fa.frequency !== null && <span title="Покази ÷ охоплення, в середньому за день за останній тиждень">частота {fa.frequency.toFixed(1)}/день</span>}
                    </div>
                  );
                })()}
                <dl className="mt-auto grid grid-cols-3 gap-2 pt-4 text-[12px]">
                  <Stat k="Витрати" v={fmtMoney(c.spend, c.currency)} />
                  <Stat k="CTR" v={fmtPct(c.ctr, 2)} />
                  <Stat k="Ліди Meta" v={fmtInt(c.metaLeads)} />
                  <Stat k="Ліди CRM" v={fmtInt(c.crm.total)} />
                  <Stat k="Якісні" v={fmtInt(c.crm.qualified)} strong />
                  <Stat k="Ціна якісного" v={c.costPerQualified ? fmtMoney(c.costPerQualified, c.currency) : "—"} strong />
                  <Stat k="Угоди" v={c.crm.won ? fmtInt(c.crm.won) : "—"} />
                  <Stat k="Виручка" v={c.revenue ? fmtMoney(c.revenue, c.currency) : "—"} />
                  <Stat k="ROMI" v={c.romi === null ? "—" : `${c.romi > 0 ? "+" : ""}${Math.round(c.romi * 100)}%`} strong />
                </dl>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-faint">{k}</dt>
      <dd className={strong ? "text-accent font-medium" : ""}>{v}</dd>
    </div>
  );
}

function flat(sp: Record<string, string | string[] | undefined>) {
  return Object.fromEntries(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
}
