import Link from "next/link";
import { fmtInt, fmtMoney, fmtPct } from "@/lib/format";
import type { Pace } from "@/lib/targets";

const MONTHS = ["січень", "лютий", "березень", "квітень", "травень", "червень", "липень", "серпень", "вересень", "жовтень", "листопад", "грудень"];

/** This month's plan: bar = done so far, tick = where we should be today, text = forecast at this pace. */
export function PacingCard({
  month,
  elapsed,
  daysInMonth,
  currency,
  items,
  canEdit,
}: {
  month: string;
  elapsed: number;
  daysInMonth: number;
  currency: string;
  items: Pace[];
  canEdit: boolean;
}) {
  const expected = elapsed / daysInMonth;
  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="label">План на {MONTHS[Number(month.slice(5, 7)) - 1]}</div>
        <div className="text-[12px] text-faint">
          день {elapsed} з {daysInMonth} · риска — де маємо бути сьогодні
          {canEdit && (
            <Link href="/admin#plan" className="ml-2 text-accent">
              змінити план
            </Link>
          )}
        </div>
      </div>
      <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((p) => {
          const money = p.key === "budget";
          const fmt = (v: number) => (money ? fmtMoney(v, currency) : fmtInt(v));
          const ratio = p.forecast / p.target;
          // Budget: both under- and overspending matter. Results: below plan is the problem.
          const tone = money
            ? ratio > 1.1
              ? "text-bad"
              : ratio < 0.85
                ? "text-muted"
                : "text-good"
            : ratio >= 1
              ? "text-good"
              : ratio < 0.85
                ? "text-bad"
                : "text-muted";
          const verdict = money
            ? ratio > 1.1
              ? "перевитрата"
              : ratio < 0.85
                ? "недовитрата"
                : "в плані"
            : ratio >= 1
              ? "виконаємо"
              : ratio < 0.85
                ? "відстаємо"
                : "майже в плані";
          return (
            <div key={p.key}>
              <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
                <span className="text-muted">{p.label}</span>
                <span className="tabular-nums">
                  <span className="font-medium">{fmt(p.actual)}</span>
                  <span className="text-faint"> / {fmt(p.target)}</span>
                </span>
              </div>
              <div className="relative mt-2 h-2 rounded-full bg-panel-2">
                <div className="h-2 rounded-full bg-accent" style={{ width: `${Math.min(100, (p.actual / p.target) * 100)}%` }} />
                <div className="absolute -top-1 h-4 w-px bg-text/60" style={{ left: `${expected * 100}%` }} />
              </div>
              <div className="mt-1.5 text-[12px]">
                <span className={tone}>{verdict}</span>
                <span className="text-faint">
                  {" "}
                  · прогноз {fmt(p.forecast)} ({fmtPct(ratio, 0)})
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
