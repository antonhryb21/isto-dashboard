import "server-only";
import { and, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { regions, targets } from "@/db/schema";
import { localDate } from "@/lib/dates";
import type { Filters } from "@/lib/filters";
import { adTotals, crmTotals } from "@/lib/queries";

const num = (v: unknown) => Number(v ?? 0) || 0;

export function monthBounds(today = localDate()) {
  const from = today.slice(0, 8) + "01";
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const to = `${today.slice(0, 8)}${String(daysInMonth).padStart(2, "0")}`;
  const elapsed = Number(today.slice(8, 10)); // today counts as a (partly) elapsed day
  return { from, to, today, daysInMonth, elapsed };
}

export async function listTargets() {
  const from = monthBounds().from;
  return db.select().from(targets).where(gte(targets.month, addMonths(from, -2))).orderBy(targets.month, targets.regionCode);
}

function addMonths(first: string, n: number) {
  const d = new Date(first + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

export type Pace = {
  key: "budget" | "leads" | "qualified" | "deals";
  label: string;
  target: number;
  actual: number;
  forecast: number;
};

/**
 * This month's plan vs. month-to-date actuals, for the regions in the current filter
 * (a region, the regions of the selected currency, or all when there is one currency).
 */
export async function monthPacing(f: Filters) {
  const b = monthBounds();
  const regionCodes = f.region ? [f.region] : f.currencyRegions;
  const rows = await db
    .select({ t: targets, currency: regions.currency })
    .from(targets)
    .leftJoin(regions, eq(regions.code, targets.regionCode))
    .where(and(eq(targets.month, b.from), ...(regionCodes ? [inArray(targets.regionCode, regionCodes)] : [])));
  if (!rows.length) return null;

  const sum = (k: "budget" | "leads" | "qualified" | "deals") => rows.reduce((a, r) => a + num(r.t[k]), 0);
  const scope: Filters = { ...f, campaign: null, platform: null };
  const [ad, crm] = await Promise.all([adTotals(scope, b.from, b.today), crmTotals(scope, b.from, b.today)]);
  const pace = (actual: number) => (actual / b.elapsed) * b.daysInMonth;
  const actuals = { budget: ad.spend, leads: crm.total - crm.junk, qualified: crm.qualified, deals: crm.won };
  const labels = { budget: "Бюджет", leads: "Ліди", qualified: "Якісні ліди", deals: "Угоди" } as const;
  const items: Pace[] = (Object.keys(labels) as Pace["key"][])
    .filter((k) => sum(k) > 0)
    .map((k) => ({ key: k, label: labels[k], target: sum(k), actual: actuals[k], forecast: pace(actuals[k]) }));
  return {
    ...b,
    currency: rows[0].currency ?? ad.currency,
    mixedCurrency: new Set(rows.map((r) => r.currency)).size > 1,
    items,
  };
}
