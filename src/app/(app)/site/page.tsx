import { Suspense } from "react";
import { parseFilters } from "@/lib/filters";
import { crmTotals } from "@/lib/queries";
import { GA4_PROPERTY_ID, Ga4Error, serviceAccountEmail, siteReport, type SiteBreakdownRow } from "@/lib/ga4";
import { fmtInt, fmtPct, fmtRange } from "@/lib/format";
import { FilterBar } from "@/components/filter-bar";
import { Empty, Kpi, SectionTitle } from "@/components/kpi";
import { SiteTrafficChart } from "@/components/charts";

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function SitePage({ searchParams }: { searchParams: SP }) {
  const f = parseFilters(await searchParams);
  const title = (
    <SectionTitle
      title="Сайт · isto.ae"
      sub={`Google Analytics 4: звідки приходять відвідувачі, що вони дивляться і скільки з них залишають заявку. ${fmtRange(f.from, f.to)}.`}
    />
  );
  const filters = (
    <Suspense>
      <FilterBar regions={[]} showRegion={false} showPlatform={false} />
    </Suspense>
  );

  if (!GA4_PROPERTY_ID) {
    return (
      <div className="flex flex-col gap-6">
        {title}
        <Setup reason="У Vercel ще немає змінної GA4_PROPERTY_ID." />
      </div>
    );
  }

  let data: Awaited<ReturnType<typeof siteReport>>;
  try {
    data = await siteReport(f.from, f.to, f.prevFrom, f.prevTo);
  } catch (e) {
    if (!(e instanceof Ga4Error)) throw e;
    return (
      <div className="flex flex-col gap-6">
        {title}
        <Setup reason={e.message} />
      </div>
    );
  }

  // Website leads in the CRM for the same days, to compare with the form sends GA4 saw.
  const [crm, crmPrev] = await Promise.all([
    crmTotals({ ...f, region: null, platform: "website", campaign: null }),
    crmTotals({ ...f, region: null, platform: "website", campaign: null }, f.prevFrom, f.prevTo),
  ]);
  const { now, prev } = data;
  const conv = now.sessions ? crm.total / now.sessions : 0;
  const convPrev = prev.sessions ? crmPrev.total / prev.sessions : 0;

  return (
    <div className="flex flex-col gap-6">
      {title}
      {filters}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Сеанси" value={fmtInt(now.sessions)} current={now.sessions} previous={prev.sessions} hint={`${fmtInt(now.screenPageViews)} переглядів сторінок`} />
        <Kpi label="Користувачі" value={fmtInt(now.totalUsers)} current={now.totalUsers} previous={prev.totalUsers} hint={`${fmtInt(now.newUsers)} нових`} />
        <Kpi
          label="Залучені сеанси"
          value={fmtPct(now.engagementRate)}
          current={now.engagementRate}
          previous={prev.engagementRate}
          hint={`середній час ${fmtDuration(now.averageSessionDuration)}`}
        />
        <Kpi
          label="Ліди з сайту в CRM"
          value={fmtInt(crm.total)}
          current={crm.total}
          previous={crmPrev.total}
          hint={`${fmtInt(now.keyEvents)} ключових подій у GA4 · конверсія ${fmtPct(conv, 2)}`}
        />
      </div>

      <section className="card p-5">
        <div className="label">Відвідуваність по днях</div>
        <div className="mt-3">{data.days.length ? <SiteTrafficChart data={data.days} /> : <Empty>За цей період даних немає.</Empty>}</div>
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <Table title="Канали" rows={data.channels} />
        <Table title="Джерело / канал" rows={data.sources} />
      </div>

      <Table title="Сторінки входу" rows={data.landing} wide />

      <div className="grid gap-5 xl:grid-cols-3">
        <Table title="Країни" rows={data.countries} compact />
        <Table title="Пристрої" rows={data.devices} compact />
        <section className="card p-5">
          <div className="label">Ключові події</div>
          {data.keyEvents.length ? (
            <ul className="mt-3 flex flex-col gap-2 text-[13px]">
              {data.keyEvents.map((k) => (
                <li key={k.name} className="flex justify-between gap-3">
                  <code className="text-[12.5px]">{k.name}</code>
                  <span className="metric">{fmtInt(k.count)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-[13px] text-muted">
              GA4 не порахував жодної ключової події. Позначте відправку форми ключовою подією в GA4 → Адміністрування → Ключові події.
            </p>
          )}
          <p className="mt-4 text-[12px] text-faint">
            Для порівняння: лідів із сайту в CRM за період — {fmtInt(crm.total)}
            {conv ? `, це ${fmtPct(conv, 2)} від сеансів` : ""}. Якщо подій у GA4 значно більше, частина заявок не доходить у CRM.
          </p>
          {convPrev ? <p className="mt-1 text-[12px] text-faint">Попередній період: {fmtPct(convPrev, 2)}.</p> : null}
        </section>
      </div>
    </div>
  );
}

function Table({ title, rows, wide, compact }: { title: string; rows: SiteBreakdownRow[]; wide?: boolean; compact?: boolean }) {
  const max = Math.max(...rows.map((r) => r.sessions), 1);
  return (
    <section className="card min-w-0 p-5">
      <div className="label">{title}</div>
      {rows.length === 0 ? (
        <p className="mt-3 text-[13px] text-faint">Даних немає.</p>
      ) : (
        <table className="mt-3 w-full table-fixed text-[13px]">
          <thead>
            <tr className="text-left text-[11.5px] uppercase tracking-wide text-faint">
              <th className={`pb-2 font-normal ${wide ? "w-[55%]" : compact ? "w-[50%]" : "w-[45%]"}`}>{wide ? "Сторінка" : ""}</th>
              <th className="pb-2 text-right font-normal">Сеанси</th>
              {!compact && <th className="pb-2 text-right font-normal">Залучені</th>}
              <th className="pb-2 text-right font-normal">Події</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className="border-t border-line">
                <td className="py-1.5 pr-3">
                  <div className="truncate" title={r.name}>
                    {r.name}
                  </div>
                  <div className="mt-1 h-1 rounded bg-data-1/40" style={{ width: `${(r.sessions / max) * 100}%` }} />
                </td>
                <td className="metric py-1.5 text-right">{fmtInt(r.sessions)}</td>
                {!compact && <td className="metric py-1.5 text-right text-muted">{fmtPct(r.engagementRate, 0)}</td>}
                <td className="metric py-1.5 text-right">{r.keyEvents ? fmtInt(r.keyEvents) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Setup({ reason }: { reason: string }) {
  const email = serviceAccountEmail();
  return (
    <div className="card flex flex-col gap-3 p-5 text-[13.5px] leading-relaxed">
      <div className="font-medium text-warn">GA4 ще не підключено: {reason}</div>
      <ol className="list-decimal pl-5 text-muted">
        <li>
          У Vercel додайте змінну <code>GA4_PROPERTY_ID</code> — ID ресурсу GA4 (для isto.ae це <code>559806751</code>) і зробіть Redeploy.
        </li>
        <li>
          У GA4 → Адміністрування → Керування доступом до ресурсу додайте{" "}
          {email ? <code>{email}</code> : "email сервісного акаунта (client_email з JSON-ключа)"} з роллю «Читач».
        </li>
        <li>У Google Cloud того ж сервісного акаунта увімкніть «Google Analytics Data API».</li>
      </ol>
    </div>
  );
}

/** 95 → "1 хв 35 с". */
function fmtDuration(seconds: number) {
  const s = Math.round(seconds);
  if (s < 60) return `${s} с`;
  return `${Math.floor(s / 60)} хв ${s % 60} с`;
}
