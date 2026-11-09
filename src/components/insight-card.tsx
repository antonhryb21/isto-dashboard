import type { AiInsight } from "@/db/schema";

export const SEVERITY: Record<AiInsight["severity"], { label: string; cls: string; color: string }> = {
  critical: { label: "Критично", cls: "x text-bad", color: "var(--bad)" },
  warning: { label: "Увага", cls: "x text-warn", color: "var(--warn)" },
  info: { label: "До відома", cls: "x text-muted", color: "var(--steel)" },
  good: { label: "Працює добре", cls: "x text-good", color: "var(--good)" },
};

const CATEGORY: Record<string, string> = {
  budget: "Бюджет",
  performance: "Ефективність",
  creative: "Креативи",
  funnel: "Воронка",
  crm: "CRM",
  plan: "План",
  social: "Соцмережі",
  competitors: "Конкуренти",
  data: "Дані",
};

const CONFIDENCE = { high: "висока", medium: "середня", low: "низька" } as const;

export function InsightCard({ i }: { i: AiInsight }) {
  const sev = SEVERITY[i.severity] ?? SEVERITY.info;
  return (
    <article className="card p-5" style={{ borderLeft: `3px solid ${sev.color}` }}>
      <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.08em]">
        <span className={sev.cls.split(" ").slice(1).join(" ")}>{sev.label}</span>
        <span className="text-faint">· {CATEGORY[i.category] ?? i.category}</span>
        <span className="text-faint normal-case tracking-normal">· впевненість {CONFIDENCE[i.confidence] ?? i.confidence}</span>
      </div>
      <h3 className="mt-2 text-[16px] font-medium leading-snug">{i.title}</h3>
      <ul className="mt-3 flex flex-col gap-1 text-[12.5px] text-muted">
        {i.evidence.map((e) => (
          <li key={e} className="flex gap-2">
            <span className="text-faint">—</span>
            <span>{e}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 rounded-md bg-panel-2 p-3 text-[13px]">
        <span className="font-medium">Що зробити: </span>
        {i.action}
      </div>
      {i.expectedEffect && <p className="mt-2 text-[12px] text-faint">Очікуваний ефект: {i.expectedEffect}</p>}
    </article>
  );
}
