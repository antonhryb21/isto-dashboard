"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { PRESETS, parseFilters } from "@/lib/filters";

type Option = { value: string; label: string };

export function FilterBar({
  regions,
  campaigns,
  showPlatform = true,
  showType = false,
  showCampaign = false,
  showSearch = false,
  searchPlaceholder = "Пошук",
  showRegion = true,
  autoRange,
  currencies = [],
  currency = null,
}: {
  regions: Option[];
  campaigns?: Option[];
  showPlatform?: boolean;
  showType?: boolean;
  showCampaign?: boolean;
  showSearch?: boolean;
  searchPlaceholder?: string;
  showRegion?: boolean;
  /** Range a page shows when the URL picks no period (Reports); no preset is highlighted then. */
  autoRange?: { from: string; to: string };
  /** Ad account currencies when there are several and no region is chosen; spend is shown per currency. */
  currencies?: string[];
  currency?: string | null;
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const f = parseFilters(Object.fromEntries(sp.entries()));
  const explicit = Boolean(sp.get("p") || (sp.get("from") && sp.get("to")));
  const auto = autoRange && !explicit;
  const preset = auto ? null : f.preset;
  // The date fields always show the range in effect, so a preset can be fine-tuned by editing a date.
  const from = auto ? autoRange.from : f.from;
  const to = auto ? autoRange.to : f.to;

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    start(() => router.push(`${path}?${next.toString()}`));
  };

  return (
    <div className={`flex flex-wrap items-center gap-2 transition-opacity ${pending ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <button key={p.key} className="chip" data-active={preset === p.key} onClick={() => set({ p: p.key, from: null, to: null })}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`text-[12px] ${preset === "custom" ? "text-text" : "text-faint"}`}>Свій період:</span>
        <input
          type="date"
          className="input min-w-0"
          value={from}
          max={to}
          onChange={(e) => e.target.value && set({ from: e.target.value, to: e.target.value > to ? e.target.value : to, p: null })}
          aria-label="Від"
        />
        <span className="text-faint">–</span>
        <input
          type="date"
          className="input min-w-0"
          value={to}
          min={from}
          onChange={(e) => e.target.value && set({ to: e.target.value, from: e.target.value < from ? e.target.value : from, p: null })}
          aria-label="До"
        />
        {autoRange && explicit && (
          <button className="text-[12px] text-faint underline-offset-2 hover:underline" onClick={() => set({ p: null, from: null, to: null })}>
            скинути
          </button>
        )}
      </div>
      {showRegion && (
        <select className="input" value={sp.get("region") ?? ""} onChange={(e) => set({ region: e.target.value, cur: null })}>
          <option value="">Усі регіони</option>
          {regions.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      )}
      {showPlatform && (
        <select className="input" value={sp.get("platform") ?? ""} onChange={(e) => set({ platform: e.target.value })}>
          <option value="">Усі платформи</option>
          <option value="ig">Instagram</option>
          <option value="fb">Facebook</option>
        </select>
      )}
      {showType && (
        <select className="input" value={sp.get("type") ?? ""} onChange={(e) => set({ type: e.target.value })}>
          <option value="">Усі типи</option>
          <option value="post">Пост</option>
          <option value="carousel">Карусель</option>
          <option value="reel">Reels</option>
          <option value="video">Відео</option>
        </select>
      )}
      {showCampaign && campaigns && (
        <select className="input max-w-64" value={sp.get("campaign") ?? ""} onChange={(e) => set({ campaign: e.target.value })}>
          <option value="">Усі кампанії</option>
          {campaigns.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      )}
      {currencies.length > 1 && (
        <div className="flex items-center gap-1 text-[12px] text-faint" title="Рекламні кабінети в різних валютах не додаються між собою">
          Валюта:
          {currencies.map((c) => (
            <button key={c} className="chip" data-active={currency === c} onClick={() => set({ cur: c })}>
              {c}
            </button>
          ))}
        </div>
      )}
      {showSearch && (
        <input
          className="input min-w-48"
          placeholder={searchPlaceholder}
          defaultValue={sp.get("q") ?? ""}
          onKeyDown={(e) => {
            if (e.key === "Enter") set({ q: (e.target as HTMLInputElement).value });
          }}
        />
      )}
    </div>
  );
}
