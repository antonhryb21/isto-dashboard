import Link from "next/link";
import { STATUSES, type StatusCode } from "@/lib/statuses";
import { fmtInt, fmtPct, plural } from "@/lib/format";

const GROUPS: { title: string; stages: string[] }[] = [
  { title: "У роботі", stages: ["open"] },
  { title: "Результат", stages: ["won", "lost"] },
  { title: "Не клієнти", stages: ["junk"] },
];

/**
 * Where the leads of the current filters stand: one bar split by status for the overall picture,
 * then each status with its count and share. A row opens the list filtered to that status.
 */
export function StatusChart({
  counts,
  active,
  href,
}: {
  counts: Record<string, number>;
  active: string | null;
  href: (status: StatusCode | null) => string;
}) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...STATUSES.map((s) => counts[s.code] ?? 0));
  const share = (n: number) => (total ? n / total : 0);

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="label">Статуси лідів</div>
        <div className="text-[12px] text-faint">
          {fmtInt(total)} {plural(total, ["лід", "ліди", "лідів"])} за вибраними фільтрами
          {active && (
            <>
              {" · "}
              <Link href={href(null)} className="text-muted hover:text-text">
                показати всі
              </Link>
            </>
          )}
        </div>
      </div>

      {total === 0 ? (
        <p className="py-6 text-center text-sm text-faint">За цими фільтрами лідів немає.</p>
      ) : (
        <>
          <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-panel-2" role="img" aria-label="Частка лідів у кожному статусі">
            {STATUSES.filter((s) => counts[s.code]).map((s) => (
              <Link
                key={s.code}
                href={href(s.code)}
                title={`${s.label}: ${fmtInt(counts[s.code])} (${fmtPct(share(counts[s.code]), 0)})`}
                className="h-full transition-opacity hover:opacity-80"
                style={{ width: `${share(counts[s.code]) * 100}%`, background: s.color, opacity: active && active !== s.code ? 0.35 : 1 }}
              />
            ))}
          </div>

          <div className="mt-5 grid gap-x-8 gap-y-5 md:grid-cols-3">
            {GROUPS.map((g) => {
              const items = STATUSES.filter((s) => g.stages.includes(s.stage));
              const sum = items.reduce((a, s) => a + (counts[s.code] ?? 0), 0);
              return (
                <div key={g.title}>
                  <div className="mb-2 flex items-baseline justify-between text-[12px]">
                    <span className="text-muted">{g.title}</span>
                    <span className="tabular-nums text-faint">
                      {fmtInt(sum)} · {fmtPct(share(sum), 0)}
                    </span>
                  </div>
                  <ul className="flex flex-col gap-1">
                    {items.map((s) => {
                      const n = counts[s.code] ?? 0;
                      const isActive = active === s.code;
                      return (
                        <li key={s.code}>
                          <Link
                            href={href(isActive ? null : s.code)}
                            className={`grid grid-cols-[minmax(0,8.5rem)_1fr_auto] items-center gap-3 rounded px-1.5 py-1 text-[12.5px] hover:bg-panel-2 ${
                              isActive ? "bg-panel-2" : ""
                            } ${n ? "" : "text-faint"}`}
                          >
                            <span className="flex items-center gap-1.5 truncate">
                              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color, opacity: n ? 1 : 0.4 }} />
                              {s.label}
                            </span>
                            <span className="h-1.5 rounded-full bg-panel-2">
                              <span className="block h-1.5 rounded-full" style={{ width: `${n ? Math.max(3, (n / max) * 100) : 0}%`, background: s.color }} />
                            </span>
                            <span className="w-16 text-right tabular-nums">
                              {fmtInt(n)}
                              <span className="ml-1 text-[11px] text-faint">{n ? fmtPct(share(n), 0) : ""}</span>
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
