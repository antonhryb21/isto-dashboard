"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { PRESETS } from "@/lib/filters";

type Option = { value: string; label: string };

export function FilterBar({
  regions,
  campaigns,
  showPlatform = true,
  showType = false,
  showCampaign = false,
  showSearch = false,
  searchPlaceholder = "Пошук",
}: {
  regions: Option[];
  campaigns?: Option[];
  showPlatform?: boolean;
  showType?: boolean;
  showCampaign?: boolean;
  showSearch?: boolean;
  searchPlaceholder?: string;
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const preset = sp.get("from") ? "custom" : (sp.get("p") ?? "30d");

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
      <div className="flex items-center gap-1">
        <input
          type="date"
          className="input"
          value={sp.get("from") ?? ""}
          onChange={(e) => set({ from: e.target.value, to: sp.get("to") ?? e.target.value, p: null })}
          aria-label="Від"
        />
        <span className="text-faint">–</span>
        <input
          type="date"
          className="input"
          value={sp.get("to") ?? ""}
          onChange={(e) => set({ to: e.target.value, from: sp.get("from") ?? e.target.value, p: null })}
          aria-label="До"
        />
      </div>
      <select className="input" value={sp.get("region") ?? ""} onChange={(e) => set({ region: e.target.value })}>
        <option value="">Усі регіони</option>
        {regions.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
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
