"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";

type Option = { value: string; label: string };

/** Campaign filter with search: the list holds only campaigns that ran in the chosen period. */
export function CampaignPicker({ options, value, onChange }: { options: Option[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : options;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const pick = (v: string) => {
    setOpen(false);
    setQ("");
    onChange(v);
  };

  return (
    <div ref={box} className="relative">
      <button type="button" className="input flex w-80 max-w-[85vw] items-center justify-between gap-2 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={`truncate ${current ? "" : "text-muted"}`}>{current?.label ?? "Усі кампанії"}</span>
        {current ? (
          <X
            size={14}
            className="shrink-0 text-faint hover:text-text"
            onClick={(e) => {
              e.stopPropagation();
              pick("");
            }}
            aria-label="Скинути кампанію"
          />
        ) : (
          <ChevronDown size={14} className="shrink-0 text-faint" />
        )}
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 w-full rounded-md border border-line bg-panel shadow-lg">
          <input
            autoFocus
            className="w-full border-b border-line bg-transparent px-3 py-2 text-[13px] outline-none"
            placeholder={`Пошук · кампаній за період: ${options.length}`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              if (e.key === "Enter" && shown[0]) pick(shown[0].value);
            }}
          />
          <ul className="max-h-72 overflow-y-auto py-1 text-[13px]">
            <li>
              <button type="button" className="w-full px-3 py-1.5 text-left text-muted hover:bg-panel-2" onClick={() => pick("")}>
                Усі кампанії
              </button>
            </li>
            {shown.map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  className={`w-full px-3 py-1.5 text-left hover:bg-panel-2 ${o.value === value ? "text-accent" : ""}`}
                  onClick={() => pick(o.value)}
                  title={o.label}
                >
                  <span className="line-clamp-2">{o.label}</span>
                </button>
              </li>
            ))}
            {shown.length === 0 && <li className="px-3 py-2 text-faint">Нічого не знайдено</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
