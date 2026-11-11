import "server-only";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { adInsightsDaily, campaigns, leads } from "@/db/schema";
import { SLA_MINUTES } from "@/lib/config";
import { daysAgo } from "@/lib/dates";
import type { Filters } from "@/lib/filters";
import { fmtInt, fmtMoney, plural } from "@/lib/format";
import { adTotals, crmTotals, dueFollowUps, overdueLeads, withCurrency } from "@/lib/queries";
import { lastSync, runProblems } from "@/lib/sync";
import { monthPacing } from "@/lib/targets";
import { escapeHtml as e, sendTelegram } from "@/lib/telegram";
import { latestInsights } from "@/lib/ai/insights";

const num = (v: unknown) => Number(v ?? 0) || 0;

function filters(from: string, to: string, patch: Partial<Filters> = {}): Filters {
  return { from, to, prevFrom: from, prevTo: to, preset: "custom", region: null, platform: null, campaign: null, type: null, q: null, currency: null, currencyRegions: null, ...patch };
}

/** Campaigns that spent noticeably over the last 3 days and brought no leads at all (neither Meta nor CRM). */
async function silentCampaigns(currency: string, minSpend: number) {
  const from = daysAgo(3);
  const to = daysAgo(1);
  const rows = await db
    .select({
      id: adInsightsDaily.campaignId,
      name: campaigns.name,
      spend: sql<string>`sum(${adInsightsDaily.spend})`,
      metaLeads: sql<string>`sum(${adInsightsDaily.leads})`,
    })
    .from(adInsightsDaily)
    .leftJoin(campaigns, eq(campaigns.id, adInsightsDaily.campaignId))
    .where(and(gte(adInsightsDaily.date, from), lte(adInsightsDaily.date, to), eq(adInsightsDaily.currency, currency)))
    .groupBy(adInsightsDaily.campaignId, campaigns.name);
  const out: { name: string; spend: number }[] = [];
  for (const r of rows) {
    if (!r.id || num(r.spend) < minSpend || num(r.metaLeads) > 0) continue;
    const [c] = await db
      .select({ n: sql<string>`count(*)` })
      .from(leads)
      .where(and(eq(leads.campaignId, r.id), gte(leads.createdTime, new Date(from + "T00:00:00Z"))));
    if (num(c?.n) === 0) out.push({ name: r.name ?? r.id, spend: num(r.spend) });
  }
  return out.sort((a, b) => b.spend - a.spend);
}

/**
 * Morning message: yesterday per currency, alerts (CPL spike, campaigns spending without leads,
 * leads waiting for contact, failed data sync) and this month's plan.
 */
export async function buildDigest(appUrl = process.env.APP_URL ?? "") {
  const y = daysAgo(1);
  const lines: string[] = [`<b>ISTO · ранковий звіт за ${y.slice(8, 10)}.${y.slice(5, 7)}</b>`];
  const alerts: string[] = [];

  const { currencies } = await withCurrency(filters(y, y));
  const curList = currencies.length ? currencies : [null];
  for (const cur of curList) {
    const { f } = await withCurrency(filters(y, y, { currency: cur }));
    const hist = { ...f, from: daysAgo(15), to: daysAgo(2) };
    const [ad, crm, adH, crmH] = await Promise.all([adTotals(f), crmTotals(f), adTotals(hist), crmTotals(hist)]);
    const c = cur ?? ad.currency;
    const real = crm.total - crm.junk;
    const realH = crmH.total - crmH.junk;
    const cpl = real ? ad.spend / real : null;
    const cplH = realH >= 3 ? adH.spend / realH : null;
    lines.push(
      "",
      `<b>${e(c)}</b>: витрати ${fmtMoney(ad.spend, c)} · лідів ${fmtInt(real)}${crm.qualified ? ` (якісних ${fmtInt(crm.qualified)})` : ""}` +
        (cpl !== null ? ` · CPL ${fmtMoney(cpl, c)}` : "") +
        (cplH !== null ? ` <i>(сер. за 2 тижні ${fmtMoney(cplH, c)})</i>` : ""),
    );
    if (cpl !== null && cplH !== null && cpl > cplH * 1.5 && ad.spend > 0)
      alerts.push(`📈 CPL ${e(c)} вчора ${fmtMoney(cpl, c)} — на ${Math.round((cpl / cplH - 1) * 100)}% вище середнього`);
    if (real === 0 && ad.spend > 0 && cplH !== null && ad.spend > cplH)
      alerts.push(`🕳 Вчора ${fmtMoney(ad.spend, c)} (${e(c)}) без жодного ліда`);
    if (cplH !== null) {
      const silent = await silentCampaigns(c, cplH * 2);
      for (const s of silent.slice(0, 5)) alerts.push(`💸 «${e(s.name)}»: ${fmtMoney(s.spend, c)} за 3 дні і жодного ліда`);
    }

    const plan = await monthPacing({ ...f, from: y, to: y });
    if (plan?.items.length) {
      const parts = plan.items
        .filter((p) => p.key !== "budget" || !plan.mixedCurrency)
        .map((p) => {
          const fmt = (v: number) => (p.key === "budget" ? fmtMoney(v, plan.currency) : fmtInt(v));
          return `${p.label.toLowerCase()} ${fmt(p.actual)}/${fmt(p.target)} (прогноз ${Math.round((p.forecast / p.target) * 100)}%)`;
        });
      if (parts.length) lines.push(`План місяця: ${parts.join(" · ")}`);
    }
  }

  const overdue = await overdueLeads();
  if (overdue.length) alerts.push(`⏰ ${overdue.length} ${plural(overdue.length, ["лід чекає", "ліди чекають", "лідів чекають"])} контакту довше ${SLA_MINUTES} хв робочого часу`);
  const due = await dueFollowUps();
  if (due.length) {
    const who = [...new Set(due.map((d) => d.owner).filter(Boolean))].slice(0, 5).join(", ");
    alerts.push(`🔁 ${due.length} ${plural(due.length, ["нагадування", "нагадування", "нагадувань"])} про повторний контакт на сьогодні${who ? ` (${e(who)})` : ""}`);
  }

  const problems = runProblems(await lastSync());
  if (problems.length) alerts.push(`⚠️ Дані не оновились: ${e(problems[0].step)} — ${e(problems[0].error)}`);

  if (alerts.length) lines.push("", "<b>Увага</b>", ...alerts);

  // Today's AI advice, if it was generated this morning.
  const ai = await latestInsights();
  if (ai && Date.now() - ai.createdAt.getTime() < 6 * 3600_000 && ai.summary) {
    const icon = { critical: "🚨", warning: "⚠️", info: "ℹ️", good: "✅" } as const;
    lines.push("", `<b>AI-аналіз</b> · ${ai.health ?? "—"}/100`, e(ai.summary));
    for (const i of ai.insights.slice(0, 3)) lines.push(`${icon[i.severity] ?? "•"} ${e(i.title)} — <i>${e(i.action)}</i>`);
    if (appUrl) lines.push(`<a href="${e(appUrl)}/insights">Усі інсайти</a>`);
  }
  if (appUrl) lines.push("", `<a href="${e(appUrl)}">Відкрити дашборд</a>`);
  return lines.join("\n");
}

export async function sendDigest() {
  const text = await buildDigest();
  await sendTelegram(text);
  return text;
}
