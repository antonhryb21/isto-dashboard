"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { generateInsightsAction, type ActionResult } from "@/app/actions";

export function GenerateInsightsButton({ disabled }: { disabled?: boolean }) {
  const [pending, start] = useTransition();
  const [r, setR] = useState<ActionResult | null>(null);
  return (
    <span className="flex flex-wrap items-center justify-end gap-2">
      {r && !r.ok && <span className="text-[12px] text-bad">{r.message}</span>}
      <button className="btn btn-accent" disabled={pending || disabled} onClick={() => start(async () => setR(await generateInsightsAction()))}>
        <Sparkles size={14} className={pending ? "animate-pulse" : ""} />
        {pending ? "Аналізую… (до хвилини)" : "Згенерувати зараз"}
      </button>
    </span>
  );
}
