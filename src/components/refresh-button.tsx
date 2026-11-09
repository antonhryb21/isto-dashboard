"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { syncNowAction } from "@/app/actions";

/**
 * "Data as of" + manual refresh. When the last sync failed, says so instead of pretending the data is fresh,
 * and keeps the time of the last successful update.
 */
export function RefreshButton({ lastSync, problem, isAdmin }: { lastSync: string; problem: string | null; isAdmin: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex min-w-0 items-center gap-3 text-[12px] text-faint">
      {msg ? (
        <span>{msg}</span>
      ) : problem ? (
        <span className="flex min-w-0 items-center gap-1.5 text-bad" title={problem}>
          <AlertTriangle size={13} className="shrink-0" />
          <span className="truncate">
            Дані не оновились{lastSync !== "ніколи" ? ` (актуальні на ${lastSync})` : ""}: {problem}
          </span>
          {isAdmin && (
            <Link href="/admin" className="shrink-0 underline underline-offset-2">
              деталі
            </Link>
          )}
        </span>
      ) : (
        <span title="Останнє успішне оновлення даних з Meta">Оновлено {lastSync}</span>
      )}
      <button
        className="btn shrink-0"
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
