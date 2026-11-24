"use client";

import { useActionState, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { refreshSmmAction, saveSmmAction } from "@/app/actions";
import type { SmmData } from "@/lib/smm-calc";

export const REPORTS = [
  { href: "/reports", label: "Звіт по рекламі" },
  { href: "/reports/smm", label: "SMM-звіт" },
];

/** Dropdown that switches between the reports. */
export function ReportSwitcher() {
  const path = usePathname();
  const router = useRouter();
  const current = REPORTS.find((r) => r.href === path)?.href ?? "/reports";
  return (
    <select className="input w-auto text-[13px]" value={current} onChange={(e) => router.push(e.target.value)} aria-label="Звіт">
      {REPORTS.map((r) => (
        <option key={r.href} value={r.href}>
          {r.label}
        </option>
      ))}
    </select>
  );
}

export function SmmRefreshButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2 text-[12px] text-faint">
      {msg && <span>{msg}</span>}
      <button
        className="btn"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await refreshSmmAction();
            setMsg(r.message ?? null);
          })
        }
      >
        <RefreshCw size={14} className={pending ? "animate-spin" : ""} /> {pending ? "Оновлюю…" : "Оновити з Meta"}
      </button>
    </div>
  );
}

/** Hand-typed numbers for a month: what the API cannot give (direct messages, profile visits). */
export function SmmManualForm({
  months,
  fields,
  values,
  manual,
}: {
  months: { value: string; label: string }[];
  fields: { key: keyof SmmData; label: string }[];
  /** What the month shows now (placeholder). */
  values: Record<string, Partial<Record<keyof SmmData, number>>>;
  /** Which fields of each month were typed in by hand (only these are filled in, so saving never freezes Meta's numbers). */
  manual: Record<string, string[]>;
}) {
  const [month, setMonth] = useState(months[0]?.value ?? "");
  const [state, action, pending] = useActionState(saveSmmAction, null);
  const v = values[month] ?? {};
  const own = new Set(manual[month] ?? []);
  return (
    <form action={action} className="flex flex-col gap-3" key={month}>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Місяць
          <select name="month" className="input w-44" value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        {fields.map((f) => (
          <label key={f.key} className="flex flex-col gap-1 text-[12px] text-muted">
            {f.label}
            <input
              name={f.key}
              inputMode="numeric"
              className="input w-40"
              defaultValue={own.has(f.key) ? (v[f.key] ?? "") : ""}
              placeholder={v[f.key] !== undefined ? `${new Intl.NumberFormat("uk-UA").format(v[f.key]!)} (з даних)` : "—"}
            />
          </label>
        ))}
        <button className="btn" disabled={pending}>
          {pending ? "Зберігаю…" : "Зберегти"}
        </button>
      </div>
      <p className="text-[12px] text-faint">
        Сірим показано поточне значення. Впишіть число, щоб замінити його; порожнє поле залишає дані звіту чи Meta.
        {state?.message && <span className={state.ok ? "ml-2 text-good" : "ml-2 text-bad"}>{state.message}</span>}
      </p>
    </form>
  );
}
