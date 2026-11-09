"use client";

import { useActionState, useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { removeCompetitorAction, saveCompetitorAction, syncCompetitorsAction, type ActionResult } from "@/app/actions";

function Msg({ r }: { r: ActionResult | null }) {
  if (!r) return null;
  return <span className={`text-[12px] ${r.ok ? "text-good" : "text-bad"}`}>{r.message ?? (r.ok ? "Збережено" : "Помилка")}</span>;
}

export function SyncCompetitorsButton() {
  const [pending, start] = useTransition();
  const [r, setR] = useState<ActionResult | null>(null);
  return (
    <span className="flex flex-wrap items-center justify-end gap-2">
      <Msg r={r} />
      <button className="btn" disabled={pending} onClick={() => start(async () => setR(await syncCompetitorsAction()))}>
        <RefreshCw size={14} className={pending ? "animate-spin" : ""} /> {pending ? "Оновлюю…" : "Оновити конкурентів"}
      </button>
    </span>
  );
}

export function CompetitorForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveCompetitorAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input name="username" required placeholder="instagram.com/… або @нікнейм" className="input min-w-64" />
      <input name="name" placeholder="Назва (необовʼязково)" className="input" />
      <input name="pages" placeholder="ID сторінок в Ad Library (необовʼязково)" className="input min-w-64" />
      <button className="btn btn-accent" disabled={pending}>{pending ? "Додаю…" : "Додати"}</button>
      <Msg r={state} />
    </form>
  );
}

export function RemoveCompetitor({ username }: { username: string }) {
  const [pending, start] = useTransition();
  return (
    <button className="text-[12px] text-muted hover:text-bad" disabled={pending} onClick={() => start(async () => void (await removeCompetitorAction(username)))}>
      прибрати
    </button>
  );
}
