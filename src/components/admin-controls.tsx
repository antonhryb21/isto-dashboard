"use client";

import { useActionState, useState, useTransition } from "react";
import {
  addSpreadsheetAction,
  removeUserAction,
  saveRegionAction,
  saveUserAction,
  setSourceRegionAction,
  subscribeLeadgenAction,
  syncNowAction,
  toggleSourceAction,
  type ActionResult,
} from "@/app/actions";

function Msg({ r }: { r: ActionResult | null }) {
  if (!r) return null;
  return <span className={`text-[12px] ${r.ok ? "text-good" : "text-bad"}`}>{r.message ?? (r.ok ? "Збережено" : "Помилка")}</span>;
}

export function UserForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveUserAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input name="email" type="email" required placeholder="email@gmail.com" className="input min-w-64" />
      <select name="role" className="input" defaultValue="marketing">
        <option value="marketing">Маркетинг — перегляд і CRM</option>
        <option value="viewer">Керівництво — лише перегляд</option>
        <option value="admin">Адмін</option>
      </select>
      <button className="btn btn-accent" disabled={pending}>Додати</button>
      <Msg r={state} />
    </form>
  );
}

export function RemoveUser({ email }: { email: string }) {
  const [pending, start] = useTransition();
  const [r, setR] = useState<ActionResult | null>(null);
  return (
    <span className="flex items-center gap-2">
      <button className="text-[12px] text-muted hover:text-bad" disabled={pending} onClick={() => start(async () => setR(await removeUserAction(email)))}>
        прибрати
      </button>
      {r && !r.ok && <Msg r={r} />}
    </span>
  );
}

export function RegionForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveRegionAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input name="name" required placeholder="Назва, напр. Saudi Arabia" className="input" />
      <input name="keywords" placeholder="Слова в назвах кампаній: ksa, riyadh" className="input min-w-64" />
      <input name="currency" placeholder="Валюта (AED)" className="input w-28" />
      <button className="btn" disabled={pending}>Додати регіон</button>
      <Msg r={state} />
    </form>
  );
}

export function SpreadsheetForm({ regions }: { regions: { code: string; name: string }[] }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(addSpreadsheetAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input name="spreadsheet" required placeholder="Посилання на Google Таблицю з лідами" className="input min-w-80 flex-1" />
      <select name="region" className="input">
        <option value="">Регіон визначати з назви кампанії</option>
        {regions.map((r) => (
          <option key={r.code} value={r.code}>
            {r.name}
          </option>
        ))}
      </select>
      <input name="history" placeholder="Вкладка історії статусів (необов'язково)" className="input" />
      <button className="btn" disabled={pending}>Додати таблицю</button>
      <Msg r={state} />
    </form>
  );
}

export function SourceToggle({ id, enabled }: { id: string; enabled: boolean }) {
  const [pending, start] = useTransition();
  return (
    <input type="checkbox" defaultChecked={enabled} disabled={pending} onChange={(e) => start(async () => void (await toggleSourceAction(id, e.target.checked)))} />
  );
}

export function SourceRegion({ id, value, regions }: { id: string; value: string | null; regions: { code: string; name: string }[] }) {
  const [pending, start] = useTransition();
  return (
    <select
      className="input py-1 text-[12.5px]"
      defaultValue={value ?? ""}
      disabled={pending}
      onChange={(e) => start(async () => void (await setSourceRegionAction(id, e.target.value)))}
    >
      <option value="">з назви кампанії</option>
      {regions.map((r) => (
        <option key={r.code} value={r.code}>
          {r.name}
        </option>
      ))}
    </select>
  );
}

export function SyncButtons() {
  const [pending, start] = useTransition();
  const [r, setR] = useState<ActionResult | null>(null);
  const run = (fn: () => Promise<ActionResult>) => start(async () => setR(await fn()));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <button className="btn" disabled={pending} onClick={() => run(() => syncNowAction("quick"))}>Швидке оновлення</button>
        <button className="btn" disabled={pending} onClick={() => run(() => syncNowAction("daily"))}>Повне оновлення (кампанії, креативи, пости)</button>
        <button className="btn" disabled={pending} onClick={() => run(() => syncNowAction("backfill"))}>Завантажити історію за 12 міс.</button>
        <button className="btn" disabled={pending} onClick={() => run(() => subscribeLeadgenAction())}>Підписати сторінку на ліди</button>
      </div>
      {pending && <span className="text-[12px] text-muted">Виконується, це може тривати до кількох хвилин…</span>}
      {!pending && r && <span className={`max-w-3xl break-words text-[12px] ${r.ok ? "text-good" : "text-bad"}`}>{r.message}</span>}
    </div>
  );
}
