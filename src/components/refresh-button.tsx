"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { syncNowAction } from "@/app/actions";

export function RefreshButton({ lastSync }: { lastSync: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-3 text-[12px] text-faint">
      <span title="Останнє оновлення даних з Meta і таблиць">{msg ?? `Оновлено ${lastSync}`}</span>
      <button
        className="btn"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await syncNowAction("quick");
            setMsg(r.message ?? null);
          })
        }
      >
        <RefreshCw size={13} className={pending ? "animate-spin" : ""} />
        {pending ? "Оновлюю…" : "Оновити зараз"}
      </button>
    </div>
  );
}
