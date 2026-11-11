"use client";

import { useActionState, useState, useTransition } from "react";
import { addCommentAction, quickOwnerAction, quickStatusAction, updateLeadAction, type ActionResult } from "@/app/actions";
import { LOST_REASONS, NEEDS_REASON, STATUSES, STATUS_BY_CODE, type StatusCode } from "@/lib/statuses";

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_BY_CODE[status as StatusCode];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px]">
      <span className="h-2 w-2 rounded-full" style={{ background: s?.color ?? "#64748b" }} />
      {s?.label ?? status}
    </span>
  );
}

/** Inline status dropdown for the lead list. Writes to the CRM and the Google Sheet. */
export function StatusSelect({ id, status, disabled }: { id: string; status: string; disabled?: boolean }) {
  const [value, setValue] = useState(status);
  const [pending, start] = useTransition();
  const [warn, setWarn] = useState<string | null>(null);
  if (disabled) return <StatusBadge status={status} />;
  return (
    <div className="flex flex-col">
      <select
        className="input w-32 py-1 text-[12.5px]"
        style={{ borderLeft: `3px solid ${STATUS_BY_CODE[value as StatusCode]?.color ?? "#64748b"}` }}
        value={value}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value as StatusCode;
          const prev = value;
          setValue(next);
          start(async () => {
            const r = await quickStatusAction(id, next);
            if (!r.ok) setValue(prev);
            setWarn(r.message ?? null);
          });
        }}
      >
        {STATUSES.map((s) => (
          <option key={s.code} value={s.code}>
            {s.label}
          </option>
        ))}
      </select>
      {warn && <span className="mt-1 max-w-56 text-[11px] text-bad">{warn}</span>}
    </div>
  );
}

/** Inline owner dropdown for the lead list. */
export function OwnerSelect({ id, owner, owners, disabled }: { id: string; owner: string | null; owners: string[]; disabled?: boolean }) {
  const [value, setValue] = useState(owner ?? "");
  const [pending, start] = useTransition();
  if (disabled) return <span className="text-muted">{owner ?? "—"}</span>;
  const options = value && !owners.includes(value) ? [value, ...owners] : owners;
  return (
    <select
      className={`input w-32 py-1 text-[12.5px] ${value ? "" : "text-faint"}`}
      value={value}
      disabled={pending}
      aria-label="Відповідальний"
      onChange={(e) => {
        const next = e.target.value;
        const prev = value;
        setValue(next);
        start(async () => {
          const r = await quickOwnerAction(id, next);
          if (!r.ok) setValue(prev);
        });
      }}
    >
      <option value="">не призначено</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

export function LeadForm({
  id,
  status,
  owner,
  dealAmount,
  dealCurrency,
  nextContactAt,
  lostReason,
  owners,
}: {
  id: string;
  status: string;
  owner: string | null;
  dealAmount: string | null;
  dealCurrency: string | null;
  nextContactAt: string | null;
  lostReason: string | null;
  owners: string[];
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(updateLeadAction, null);
  const [current, setCurrent] = useState(status);
  const needsReason = NEEDS_REASON.includes(current as StatusCode);
  const open = STATUS_BY_CODE[current as StatusCode]?.stage === "open";
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <label className="flex flex-col gap-1 text-[12px] text-muted">
        Статус
        <select name="status" defaultValue={status} className="input" onChange={(e) => setCurrent(e.target.value)}>
          {STATUSES.map((s) => (
            <option key={s.code} value={s.code}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[12px] text-muted">
        Відповідальний
        <input name="owner" defaultValue={owner ?? ""} list="owners" className="input" placeholder="Ім'я" />
        <datalist id="owners">
          {owners.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      </label>
      {needsReason && (
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Причина відмови
          <select name="lostReason" defaultValue={lostReason ?? ""} className="input">
            <option value="">не вказано</option>
            {(lostReason && !(LOST_REASONS as readonly string[]).includes(lostReason) ? [lostReason, ...LOST_REASONS] : LOST_REASONS).map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
      )}
      {open && (
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Наступний контакт
          <input type="date" name="nextContactAt" defaultValue={nextContactAt ?? ""} className="input" />
        </label>
      )}
      <div className="grid grid-cols-[1fr_90px] gap-2">
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Сума угоди
          <input name="dealAmount" defaultValue={dealAmount ?? ""} inputMode="decimal" className="input" placeholder="0" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Валюта
          <select name="dealCurrency" defaultValue={dealCurrency ?? "AED"} className="input">
            {["AED", "USD", "GBP"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>
      <button className="btn btn-accent justify-center" disabled={pending}>
        {pending ? "Зберігаю…" : "Зберегти"}
      </button>
      {state && (
        <p className={`text-[12px] ${state.ok && !state.message ? "text-good" : state.ok ? "text-accent" : "text-bad"}`}>
          {state.message ?? (state.ok ? "Збережено і записано в таблицю" : "Помилка")}
        </p>
      )}
    </form>
  );
}

export function CommentForm({ id }: { id: string }) {
  // Bumping the key after a successful save clears the textarea.
  const [saved, setSaved] = useState(0);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(async (prev, form) => {
    const r = await addCommentAction(prev, form);
    if (r.ok) setSaved((n) => n + 1);
    return r;
  }, null);
  return (
    <form action={action} className="flex flex-col gap-2" key={saved}>
      <input type="hidden" name="id" value={id} />
      <textarea name="text" rows={3} className="input resize-y" placeholder="Що відбулося: дзвінок, домовленість, наступний крок…" />
      <div className="flex items-center gap-3">
        <button className="btn" disabled={pending}>
          {pending ? "Додаю…" : "Додати коментар"}
        </button>
        {state && !state.ok && <span className="text-[12px] text-bad">{state.message}</span>}
      </div>
    </form>
  );
}
