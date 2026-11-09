import { Suspense } from "react";
import { parseFilters } from "@/lib/filters";
import { listRegions } from "@/lib/regions";
import { funnel, withCurrency } from "@/lib/queries";
import { fmtCompact, fmtInt, fmtMoney, fmtPct } from "@/lib/format";
import { FilterBar } from "@/components/filter-bar";
import { SectionTitle } from "@/components/kpi";

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function FunnelPage({ searchParams }: { searchParams: SP }) {
  const { f, currencies } = await withCurrency(parseFilters(await searchParams));
  const [regions, data] = await Promise.all([listRegions(), funnel(f)]);
  const s = data.stages;
  const max = Math.max(...s.map((x) => x.value), 1);
  const leads = s.find((x) => x.key === "leads")!.value;
  const won = s.find((x) => x.key === "won")!.value;

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle
        title="Воронка"
        sub="Від показу реклами до угоди. Етапи CRM рахують ліди, створені в обраний період, за найдальшим статусом, якого вони досягли."
      />
      <Suspense>
        <FilterBar currencies={currencies} currency={f.currency} regions={regions.map((r) => ({ value: r.code, label: r.name }))} />
      </Suspense>

      <div className="card p-5 text-[14px] leading-relaxed">
        За період рекламу побачили <b>{fmtCompact(s[0].value)}</b> разів, з них <b>{fmtInt(s[1].value)}</b> клікнули і{" "}
        <b>{fmtInt(leads)}</b> залишили заявку. Без спаму і нецільових — <b>{fmtInt(s[3].value)}</b> реальних лідів
        {data.junk ? <span className="text-muted"> ({fmtInt(data.junk)} відсіяно)</span> : null}.{" "}
        {won ? (
          <>
            Угод — <b>{fmtInt(won)}</b>, ціна угоди <b>{fmtMoney(data.spend / won, data.currency)}</b>.
          </>
        ) : (
          <>Угод за цей період ще немає.</>
        )}
      </div>

      <div className="card p-5">
        <div className="flex flex-col gap-2.5">
          {s.map((stage, i) => {
            const prev = i > 0 ? s[i - 1].value : null;
            const conv = prev ? stage.value / prev : null;
            const width = Math.max((stage.value / max) * 100, stage.value ? 1.5 : 0);
            const crm = i >= 2;
            return (
              <div key={stage.key}>
                {conv !== null && (
                  <div className="py-0.5 pl-44 text-[11.5px] text-faint">↓ {fmtPct(conv, conv < 0.01 ? 2 : 1)} переходять далі</div>
                )}
                <div className="flex items-center gap-4">
                  <div className="w-40 shrink-0 text-right text-[13px] text-muted">{stage.label}</div>
                  <div className="relative h-9 flex-1 rounded-md bg-panel-2">
                    <div
                      className="h-full rounded-md"
                      style={{
                        width: `${crm ? Math.max((stage.value / Math.max(leads, 1)) * 100, stage.value ? 1.5 : 0) : width}%`,
                        background: crm ? "var(--accent)" : "color-mix(in oklab, var(--text) 30%, transparent)",
                        opacity: crm ? 0.35 + 0.65 * (1 - (i - 2) / 6) : 1,
                      }}
                    />
                    <span className="absolute inset-y-0 left-3 flex items-center text-[13px] font-medium">{fmtInt(stage.value)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-4 text-[12px] text-faint">
          Покази й кліки — шкала відносно показів; етапи від «Заявки» — відносно кількості заявок, щоб їх було видно.
        </p>
      </div>
    </div>
  );
}
