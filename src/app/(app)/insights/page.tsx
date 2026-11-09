import Link from "next/link";
import { hasRole, requireUser } from "@/lib/auth/current-user";
import { aiEnabled, AI_MODEL, insightRuns } from "@/lib/ai/insights";
import { ago, fmtDate, fmtInt } from "@/lib/format";
import { Empty, SectionTitle } from "@/components/kpi";
import { InsightCard } from "@/components/insight-card";
import { GenerateInsightsButton } from "@/components/insights-controls";

type SP = Promise<Record<string, string | string[] | undefined>>;

const ORDER = { critical: 0, warning: 1, info: 2, good: 3 } as const;

export default async function InsightsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const user = await requireUser();
  const runs = await insightRuns(20);
  const ok = runs.filter((r) => !r.error);
  const chosen = (typeof sp.id === "string" && ok.find((r) => r.id === sp.id)) || ok[0] || null;
  const lastError = runs[0]?.error ? runs[0] : null;
  const enabled = aiEnabled();
  const insights = chosen ? [...chosen.insights].sort((a, b) => (ORDER[a.severity] ?? 9) - (ORDER[b.severity] ?? 9)) : [];
  const health = chosen?.health ?? null;
  const healthTone = health === null ? "text-faint" : health >= 70 ? "text-good" : health >= 45 ? "text-warn" : "text-bad";

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <SectionTitle
        title="AI-інсайти"
        sub="Щоранку о 09:30 (Київ) Claude аналізує цифри дашборду за 30 днів і пише, що відбувається і що з цим робити."
        right={hasRole(user.role, "marketing") ? <GenerateInsightsButton disabled={!enabled} /> : null}
      />

      <div className="card p-4 text-[12.5px] text-muted">
        <span className="font-medium text-text">Лише поради.</span> Claude бачить тільки зведені цифри (реклама, воронка, план, соцмережі,
        конкуренти) — без імен і телефонів лідів. Нічого не змінює в кабінетах і CRM. Перевіряйте цифри в розділах дашборду перед рішенням.
      </div>

      {!enabled && (
        <Empty>
          Щоб увімкнути, додайте у Vercel змінну ANTHROPIC_API_KEY (ключ з console.anthropic.com) і зробіть Redeploy. Після цього аналіз
          запускатиметься щоранку о 09:30 за Києвом.
        </Empty>
      )}

      {lastError && (
        <div className="card border-bad/50 p-4 text-sm">
          <span className="font-medium text-bad">Останній запуск не вдався</span>{" "}
          <span className="text-muted">
            ({fmtDate(lastError.createdAt, true)}): {lastError.error}
          </span>
        </div>
      )}

      {chosen ? (
        <>
          <div className="card grid gap-5 p-5 sm:grid-cols-[auto_1fr]">
            <div className="flex flex-col items-start sm:items-center sm:border-r sm:border-line sm:pr-6">
              <div className="label">Стан маркетингу</div>
              <div className={`metric mt-2 text-[44px] leading-none ${healthTone}`}>{health ?? "—"}</div>
              <div className="mt-1 text-[12px] text-faint">зі 100</div>
            </div>
            <div>
              <div className="label">Підсумок</div>
              <p className="mt-2 text-[15px] leading-relaxed">{chosen.summary}</p>
              <p className="mt-3 text-[11.5px] text-faint">
                {fmtDate(chosen.createdAt, true)} ({ago(chosen.createdAt)}) · дані {chosen.periodFrom} — {chosen.periodTo} ·{" "}
                {chosen.trigger === "cron" ? "щоденний запуск" : `запустив ${chosen.requestedBy ?? "користувач"}`} · {chosen.model}
                {chosen.inputTokens ? ` · ${fmtInt(chosen.inputTokens + (chosen.outputTokens ?? 0))} токенів` : ""}
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {insights.map((i) => (
              <InsightCard key={i.title} i={i} />
            ))}
          </div>
        </>
      ) : (
        enabled && <Empty>Аналізу ще не було. Натисніть «Згенерувати зараз» або дочекайтесь ранкового запуску.</Empty>
      )}

      {ok.length > 1 && (
        <div className="card p-5">
          <div className="label">Попередні аналізи</div>
          <div className="mt-3 flex flex-wrap gap-1">
            {ok.map((r) => (
              <Link key={r.id} className="chip" data-active={chosen?.id === r.id} href={`?id=${r.id}`}>
                {fmtDate(r.createdAt, true)} · {r.health ?? "—"}/100
              </Link>
            ))}
          </div>
        </div>
      )}

      <p className="text-[12px] text-faint">Модель: {AI_MODEL}. Ручний запуск — не частіше разу на годину.</p>
    </div>
  );
}
