import { Suspense } from "react";
import { Play } from "lucide-react";
import { parseFilters } from "@/lib/filters";
import { listRegions } from "@/lib/regions";
import { campaignOptions, creativeFatigue, creativeTable, withCurrency } from "@/lib/queries";
import { fmtCompact, fmtInt, fmtMoney, fmtPct } from "@/lib/format";
import { MIN_SAMPLE, adStatusLabel } from "@/lib/ad-labels";
import { FilterBar } from "@/components/filter-bar";
import { Empty, SectionTitle } from "@/components/kpi";

type SP = Promise<Record<string, string | string[] | undefined>>;

const LEAD_SORTS = {
  qualified: { label: "Якісні ліди", fn: (a: Row, b: Row) => b.crm.qualified - a.crm.qualified || b.spend - a.spend },
  spend: { label: "Витрати", fn: (a: Row, b: Row) => b.spend - a.spend },
  cpq: { label: "Ціна якісного ліда", fn: (a: Row, b: Row) => (a.costPerQualified || Infinity) - (b.costPerQualified || Infinity) },
  ctr: { label: "CTR", fn: (a: Row, b: Row) => b.ctr - a.ctr },
  tired: { label: "Спершу втомлені", fn: () => 0 },
  romi: { label: "ROMI", fn: (a: Row, b: Row) => (b.romi ?? -Infinity) - (a.romi ?? -Infinity) || b.revenue - a.revenue },
};
const PROMO_SORTS = {
  engagement: { label: "Взаємодії", fn: (a: Row, b: Row) => b.engagement - a.engagement || b.spend - a.spend },
  spend: { label: "Витрати", fn: (a: Row, b: Row) => b.spend - a.spend },
  cpe: { label: "Ціна взаємодії", fn: (a: Row, b: Row) => (a.costPerEngagement || Infinity) - (b.costPerEngagement || Infinity) },
  impressions: { label: "Покази", fn: (a: Row, b: Row) => b.impressions - a.impressions },
  saves: { label: "Збереження", fn: (a: Row, b: Row) => b.saves - a.saves },
  tired: { label: "Спершу втомлені", fn: () => 0 },
};
type Sort = { label: string; fn: (a: Row, b: Row) => number };
type Row = Awaited<ReturnType<typeof creativeTable>>[number];

export default async function CreativesPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { f, currencies } = await withCurrency(parseFilters(sp));
  const goal = sp.goal === "promo" ? "promo" : "leads";
  const SORTS: Record<string, Sort> = goal === "promo" ? PROMO_SORTS : LEAD_SORTS;
  const sortKey = typeof sp.sort === "string" && sp.sort in SORTS ? sp.sort : Object.keys(SORTS)[0];
  const [regions, camps, all, fatigue] = await Promise.all([listRegions(), campaignOptions(f), creativeTable(f), creativeFatigue(f.to)]);
  const leadCount = all.filter((c) => c.isLead).length;
  const rowsRaw = all.filter((c) => c.isLead === (goal === "leads"));
  const rows =
    sortKey === "tired"
      ? [...rowsRaw].sort((a, b) => Number(!!fatigue.get(b.id)?.tired) - Number(!!fatigue.get(a.id)?.tired) || b.spend - a.spend)
      : [...rowsRaw].sort(SORTS[sortKey].fn);
  const active = rows.filter((c) => isRunning(c.status));
  const stopped = rows.filter((c) => !isRunning(c.status));

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
        Ціль:
        {[
          { k: "leads", label: "Лідогенерація", n: leadCount },
          { k: "promo", label: "Просування", n: all.length - leadCount },
        ].map((g) => {
          const { sort: _sort, ...rest } = flat(sp);
          void _sort;
          return (
            <a key={g.k} className="chip" data-active={g.k === goal} href={`?${new URLSearchParams({ ...rest, goal: g.k })}`}>
              {g.label} <span className="text-faint">{fmtInt(g.n)}</span>
            </a>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-1 text-[12px] text-muted">
        Сортувати:
        {Object.entries(SORTS).map(([k, s]) => (
          <a key={k} className="chip" data-active={k === sortKey} href={`?${new URLSearchParams({ ...flat(sp), sort: k })}`}>
            {s.label}
          </a>
        ))}
      </div>

      {rows.length === 0 ? (
        <Empty>{goal === "promo" ? "Оголошень на просування з показами за цей період немає." : "Оголошень на лідогенерацію з показами за цей період немає."}</Empty>
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-2">
          {[
            { title: "Активні", list: active, empty: "Активних оголошень з показами за цей період немає." },
            { title: "На паузі", list: stopped, empty: "Усі оголошення з показами за період зараз активні." },
          ].map((col) => (
            <section key={col.title} className="flex min-w-0 flex-col gap-3">
              <h2 className="flex items-baseline gap-2 text-[16px] font-medium">
                {col.title}
                <span className="text-[13px] font-normal text-faint">{fmtInt(col.list.length)}</span>
              </h2>
              {col.list.length === 0 ? (
                <Empty>{col.empty}</Empty>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                  {col.list.map((c) => (
                    <CreativeCard key={c.id} c={c} fatigue={fatigue} />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/** Delivering or about to: everything Meta has not stopped (paused, archived, deleted, rejected). */
const RUNNING = new Set(["ACTIVE", "IN_PROCESS", "PENDING_REVIEW", "PREAPPROVED", "WITH_ISSUES", "PENDING_BILLING_INFO"]);
function isRunning(status: string | null | undefined) {
  return RUNNING.has((status ?? "").toUpperCase());
}

function CreativeCard({ c, fatigue }: { c: Row; fatigue: Awaited<ReturnType<typeof creativeFatigue>> }) {
  return (
    <article className="card overflow-hidden flex flex-col">
      <a href={c.permalink ?? undefined} target="_blank" rel="noreferrer" className="relative block bg-panel-2">
        {c.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.thumbnail} alt="" className="aspect-square w-full object-cover" loading="lazy" />
        ) : (
          <div className="aspect-square" />
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
        {adStatusLabel(c.status) && (
          <span className="absolute left-2 top-2 rounded-full bg-overlay px-2 py-0.5 text-[11px] text-white">{adStatusLabel(c.status)}</span>
        )}
      </a>
      <div className="flex flex-1 flex-col p-3">
        <div className="truncate text-[13px] font-medium" title={c.name}>
          {c.name}
        </div>
        <div className="truncate text-[12px] text-faint" title={c.campaignName ?? ""}>
          {c.campaignName}
        </div>
        {c.body && <p className="mt-1.5 line-clamp-1 text-[12px] text-muted" title={c.body}>{c.body}</p>}
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
        {c.isLead ? (
          <dl className="mt-auto grid grid-cols-3 gap-x-2 gap-y-1.5 pt-3 text-[11.5px]">
            <Stat k="Витрати" v={fmtMoney(c.spend, c.currency)} />
            <Stat k="CTR" v={fmtPct(c.ctr, 2)} />
            <Stat k="Ліди Meta" v={fmtInt(c.metaLeads)} />
            <Stat k="Ліди CRM" v={fmtInt(c.crm.total)} />
            <Stat k="Якісні" v={fmtInt(c.crm.qualified)} strong />
            <Stat
              k="Ціна якісного"
              v={c.costPerQualified ? `${c.crm.qualified < MIN_SAMPLE ? "≈ " : ""}${fmtMoney(c.costPerQualified, c.currency)}` : "—"}
              strong={c.crm.qualified >= MIN_SAMPLE}
              title={c.crm.qualified && c.crm.qualified < MIN_SAMPLE ? `Лише ${c.crm.qualified} якісних: орієнтир, а не результат` : undefined}
            />
            <Stat k="Угоди" v={c.crm.won ? fmtInt(c.crm.won) : "—"} />
            <Stat k="Виручка" v={c.revenue ? fmtMoney(c.revenue, c.currency) : "—"} />
            <Stat k="ROMI" v={c.romi === null ? "—" : `${c.romi > 0 ? "+" : ""}${Math.round(c.romi * 100)}%`} strong />
          </dl>
        ) : (
          <dl className="mt-auto grid grid-cols-3 gap-x-2 gap-y-1.5 pt-3 text-[11.5px]">
            <Stat k="Витрати" v={fmtMoney(c.spend, c.currency)} />
            <Stat k="Покази" v={fmtCompact(c.impressions)} />
            <Stat k="CPM" v={c.cpm ? fmtMoney(c.cpm, c.currency, 1) : "—"} />
            <Stat k="Взаємодії" v={fmtInt(c.engagement)} strong title="Взаємодії зі сторінкою й дописом за даними Meta: реакції, коментарі, збереження, перегляди профілю тощо" />
            <Stat k="Ціна взаємодії" v={c.costPerEngagement ? fmtMoney(c.costPerEngagement, c.currency, 2) : "—"} strong />
            <Stat k="Збереження" v={fmtInt(c.saves)} />
          </dl>
        )}
      </div>
    </article>
  );
}

function Stat({ k, v, strong, title }: { k: string; v: string; strong?: boolean; title?: string }) {
  return (
    <div title={title}>
      <dt className="text-faint">{k}</dt>
      <dd className={strong ? "text-accent font-medium" : ""}>{v}</dd>
    </div>
  );
}

function flat(sp: Record<string, string | string[] | undefined>) {
  return Object.fromEntries(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
}
