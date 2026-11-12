import { Suspense } from "react";
import Link from "next/link";
import { parseFilters } from "@/lib/filters";
import { listRegions } from "@/lib/regions";
import {
  adDaily,
  adTotals,
  campaignOptions,
  creativeFatigue,
  creativeTable,
  crmTotals,
  dueFollowUps,
  followers,
  leadsDaily,
  overdueLeads,
  ownerSpeed,
  socialTotals,
  romiFor,
  withCurrency,
} from "@/lib/queries";
import { ago, fmtCompact, fmtInt, fmtMoney, fmtPct, fmtRange, plural } from "@/lib/format";
import { MIN_SAMPLE } from "@/lib/ad-labels";
import { SLA_MINUTES } from "@/lib/config";
import { FilterBar } from "@/components/filter-bar";
import { Kpi, SectionTitle } from "@/components/kpi";
import { SpendLeadsChart } from "@/components/charts";
import { lastOkSync } from "@/lib/sync";
import { monthPacing } from "@/lib/targets";
import { PacingCard } from "@/components/pacing";
import { latestInsights } from "@/lib/ai/insights";
import { SEVERITY } from "@/components/insight-card";
import { hasRole, requireUser } from "@/lib/auth/current-user";

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function Overview({ searchParams }: { searchParams: SP }) {
  const { f, currencies } = await withCurrency(parseFilters(await searchParams));
  const [regions, camps, everSynced] = await Promise.all([listRegions(), campaignOptions(f), lastOkSync()]);
  const [user, plan, ai] = await Promise.all([requireUser(), monthPacing(f), latestInsights()]);
  const [ad, adPrev, crm, crmPrev, daily, leadDays, social, socialPrev, fol, creatives] = await Promise.all([
    adTotals(f),
    adTotals(f, f.prevFrom, f.prevTo),
    crmTotals(f),
    crmTotals(f, f.prevFrom, f.prevTo),
    adDaily(f),
    leadsDaily(f),
    socialTotals(f),
    socialTotals(f, f.prevFrom, f.prevTo),
    followers(),
    creativeTable(f),
  ]);
  const [overdue, due, byOwner, fatigue] = await Promise.all([overdueLeads(f.region), dueFollowUps(f.region), ownerSpeed(f), creativeFatigue(f.to)]);
  const unassignedNew = byOwner.find((o) => !o.owner)?.waiting ?? 0;
  const tired = creatives.filter((c) => c.status === "ACTIVE" && fatigue.get(c.id)?.tired).length;
  const isAdmin = hasRole(user.role, "admin");
  const attention = [
    overdue.length && {
      tone: "bad",
      text: `${overdue.length} ${plural(overdue.length, ["лід чекає", "ліди чекають", "лідів чекають"])} контакту довше ${SLA_MINUTES} хв робочого часу`,
      href: "/crm?overdue=1",
    },
    due.length && { tone: "warn", text: `${due.length} ${plural(due.length, ["нагадування", "нагадування", "нагадувань"])} про повторний контакт на сьогодні`, href: "/crm?due=1" },
    unassignedNew && { tone: "warn", text: `${unassignedNew} ${plural(unassignedNew, ["новий лід", "нові ліди", "нових лідів"])} без відповідального`, href: "/crm?owner=-&status=new" },
    tired && { tone: "warn", text: `${tired} ${plural(tired, ["активний креатив втомився", "активні креативи втомились", "активних креативів втомились"])}: CTR за тиждень упав на 30%+`, href: "/creatives?sort=tired" },
    !plan && isAdmin && { tone: "info", text: "План на цей місяць не задано: без нього не видно темпу бюджету й лідів", href: "/admin" },
  ].filter(Boolean) as { tone: "bad" | "warn" | "info"; text: string; href: string }[];
  const fewQualified = crm.adQualified > 0 && crm.adQualified < MIN_SAMPLE;

  const cur = ad.currency;
  // "0" only when there really were no results; "—" when there is nothing to compute from.
  const noAds = ad.impressions === 0 && ad.spend === 0;
  const money = romiFor(ad.spend, cur, crm.revenueByCurrency);
  const moneyPrev = romiFor(adPrev.spend, cur, crmPrev.revenueByCurrency);
  const crmLeads = crm.total - crm.junk;
  // Cost metrics count only leads the ads brought; leads typed in by hand are left out.
  const cplReal = crm.adLeads ? ad.spend / crm.adLeads : 0;
  const cplRealPrev = crmPrev.adLeads ? adPrev.spend / crmPrev.adLeads : 0;
  const costQualified = crm.adQualified ? ad.spend / crm.adQualified : 0;
  const costQualifiedPrev = crmPrev.adQualified ? adPrev.spend / crmPrev.adQualified : 0;

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
  // Ranked by qualified leads; until there are any, by leads the ad brought.
  const withQualified = creatives.filter((c) => c.crm.qualified > 0).sort((a, b) => b.crm.qualified - a.crm.qualified || a.costPerQualified - b.costPerQualified);
  const top = (withQualified.length ? withQualified : creatives.filter((c) => c.metaLeads > 0).sort((a, b) => b.metaLeads - a.metaLeads || a.cpl - b.cpl)).slice(0, 3);

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle
        title="Огляд"
        sub={`${fmtRange(f.from, f.to)} · порівняння з ${fmtRange(f.prevFrom, f.prevTo)}`}
      />
      {!everSynced && noAds && (
        <div className="card border-bad/40 p-4 text-sm text-muted">
          <span className="font-medium text-text">Дані з Meta ще не завантажені.</span> Поки що порожні показники означають «немає даних», а не нуль
          результатів. Після підключення токена Meta реклама, пости й ліди підтягнуться автоматично.
        </div>
      )}
      <Suspense>
        <FilterBar currencies={currencies} currency={f.currency}
          regions={regions.map((r) => ({ value: r.code, label: r.name }))}
          campaigns={camps.map((c) => ({ value: c.id, label: c.name }))}
          showCampaign
        />
      </Suspense>

      {attention.length > 0 && (
        <div className="card p-4">
          <div className="label">Потребує уваги сьогодні</div>
          <ul className="mt-2.5 flex flex-col gap-1.5 text-[13.5px]">
            {attention.map((a) => (
              <li key={a.href + a.text}>
                <Link href={a.href} className="group flex items-center gap-2.5">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${a.tone === "bad" ? "bg-bad" : a.tone === "warn" ? "bg-warn" : "bg-faint"}`} />
                  <span className="group-hover:text-accent">{a.text}</span>
                  <span className="text-faint">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Витрати" value={fmtMoney(ad.spend, cur)} current={ad.spend} previous={adPrev.spend} empty={noAds} hint={noAds ? "немає даних реклами за період" : undefined} />
        <Kpi
          label="Ліди (усього)"
          value={fmtInt(crm.total)}
          current={crm.total}
          previous={crmPrev.total}
          hint={`${fmtInt(crmLeads)} без спаму${crm.manual ? ` · ${fmtInt(crm.manual)} вручну` : ""}`}
        />
        <Kpi
          label="Ціна ліда"
          value={fmtMoney(cplReal, cur)}
          current={cplReal}
          previous={cplRealPrev}
          goodWhenDown
          empty={noAds || !crm.adLeads}
          hint={[ad.metaLeads ? `за Meta: ${fmtMoney(ad.cpl, cur)}` : null, crm.manual ? "без доданих вручну" : null].filter(Boolean).join(" · ") || undefined}
        />
        <Kpi
          label="Ціна якісного ліда"
          value={`${fewQualified ? "≈ " : ""}${fmtMoney(costQualified, cur)}`}
          current={fewQualified ? undefined : costQualified}
          previous={fewQualified ? undefined : costQualifiedPrev}
          goodWhenDown
          accent={!fewQualified}
          empty={noAds || !crm.adQualified}
          hint={fewQualified ? `лише ${fmtInt(crm.adQualified)} якісних — орієнтир, не результат` : `${fmtInt(crm.qualified)} якісних`}
        />
        <Kpi label="Зустрічі" value={fmtInt(crm.meetings)} current={crm.meetings} previous={crmPrev.meetings} />
        <Kpi label="Угоди" value={fmtInt(crm.won)} current={crm.won} previous={crmPrev.won} hint={money.revenue ? `виручка ${fmtMoney(money.revenue, cur)}` : undefined} />
        <Kpi label="CTR · CPM" value={fmtPct(ad.ctr, 2)} current={ad.ctr} previous={adPrev.ctr} empty={noAds} hint={noAds ? undefined : `CPM ${fmtMoney(ad.cpm, cur, 1)}`} />
        <Kpi
          label="ROMI"
          value={money.romi === null ? "—" : `${money.romi > 0 ? "+" : ""}${Math.round(money.romi * 100)}%`}
          empty={money.romi === null}
          hint={
            money.romi === null
              ? "зʼявиться з першою угодою із сумою"
              : moneyPrev.romi !== null
                ? `попередній період ${moneyPrev.romi > 0 ? "+" : ""}${Math.round(moneyPrev.romi * 100)}%`
                : "(виручка − витрати) ÷ витрати"
          }
        />
      </div>

      {plan && plan.items.some((p) => p.key !== "budget" || !plan.mixedCurrency) && (
        <PacingCard
          month={plan.from}
          elapsed={plan.elapsed}
          daysInMonth={plan.daysInMonth}
          currency={plan.currency}
          items={plan.mixedCurrency ? plan.items.filter((p) => p.key !== "budget") : plan.items}
          canEdit={isAdmin}
        />
      )}

      {ai && (
        <div className="card p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="label">AI-аналіз · {ai.health ?? "—"}/100</div>
            <Link href="/insights" className="text-[12px] text-accent">
              усі інсайти ({ai.insights.length}) · {ago(ai.createdAt)} →
            </Link>
          </div>
          <p className="mt-2 line-clamp-3 text-[13.5px] leading-relaxed">{ai.summary}</p>
          <ul className="mt-3 flex flex-col gap-1.5 text-[13px]">
            {ai.insights.slice(0, 3).map((i) => (
              <li key={i.title} className="flex gap-2">
                <span className={`shrink-0 text-[11px] uppercase tracking-[0.06em] ${SEVERITY[i.severity]?.cls.split(" ").slice(1).join(" ")}`}>
                  {SEVERITY[i.severity]?.label}
                </span>
                <span>{i.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

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
            <div className="label">{withQualified.length ? "Найкращі креативи за якісними лідами" : "Креативи з найбільшою кількістю лідів"}</div>
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
                    {withQualified.length ? `${c.crm.qualified} якісних` : `${c.metaLeads} лідів`} · {fmtMoney(c.spend, cur)}
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
