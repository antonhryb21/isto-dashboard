import { delta } from "@/lib/filters";
import { fmtPct } from "@/lib/format";

/**
 * A headline number with its change vs the previous period.
 * `goodWhenDown` flips the colour for costs (CPL going down is good).
 */
export function Kpi({
  label,
  value,
  current,
  previous,
  hint,
  goodWhenDown = false,
  accent = false,
}: {
  label: string;
  value: string;
  current?: number;
  previous?: number;
  hint?: string;
  goodWhenDown?: boolean;
  accent?: boolean;
}) {
  const d = current !== undefined && previous !== undefined ? delta(current, previous) : undefined;
  const good = d === null || d === undefined ? null : goodWhenDown ? d < 0 : d > 0;
  return (
    <div className={`card p-5 ${accent ? "border-accent" : ""}`}>
      <div className="label">{label}</div>
      <div className="metric mt-3 text-[30px]">{value}</div>
      <div className="mt-3 flex items-center gap-2 text-[12px]">
        {d !== undefined && (
          <span className={d === null || d === 0 ? "text-faint" : good ? "text-good" : "text-bad"}>
            {d === null ? "нове" : `${d > 0 ? "▲" : d < 0 ? "▼" : ""} ${fmtPct(Math.abs(d), 0)}`}
          </span>
        )}
        {hint && <span className="text-faint truncate">{hint}</span>}
      </div>
    </div>
  );
}

export function SectionTitle({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="display text-[32px]">{title}</h1>
        {sub && <p className="serif mt-2 text-[15px] text-muted">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="card p-8 text-center text-sm text-muted">{children}</div>;
}
