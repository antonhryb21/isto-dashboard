"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { createLeadAction, type CreateLeadResult } from "@/app/actions";
import { LEAD_PLATFORMS } from "@/lib/lead-source";
import { STATUSES } from "@/lib/statuses";

/** Local date and time in the shape a datetime-local input expects. */
const localNow = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

type Region = { code: string; name: string };

/**
 * "Новий лід": a lead that did not come from a Meta form — an incoming call, a referral, a direct message.
 * Saved with source "manual", so it never counts as a result of ad spend.
 */
export function NewLeadButton({ regions, owners, me }: { regions: Region[]; owners: string[]; me: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn btn-accent flex items-center gap-1.5" onClick={() => setOpen(true)}>
        <Plus size={14} /> Новий лід
      </button>
      {open && <NewLeadDialog regions={regions} owners={owners} me={me} onClose={() => setOpen(false)} />}
    </>
  );
}

function NewLeadDialog({ regions, owners, me, onClose }: { regions: Region[]; owners: string[]; me: string; onClose: () => void }) {
  const [state, action, pending] = useActionState<CreateLeadResult | null, FormData>(createLeadAction, null);
  // Controlled fields: React clears an uncontrolled form after every action, and a failed
  // save must not wipe what the person typed.
  const [v, setV] = useState({
    fullName: "",
    phone: "",
    email: "",
    city: "",
    region: regions[0]?.code ?? "",
    platform: "call",
    owner: me,
    status: "contacted",
    interest: "",
    created: localNow(),
    comment: "",
    force: false,
  });
  const set = <K extends keyof typeof v>(k: K, value: (typeof v)[K]) => setV((prev) => ({ ...prev, [k]: value }));
  const ownerList = owners.includes(me) ? owners : [me, ...owners];
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    dialog.current?.querySelector<HTMLInputElement>("input[name=fullName]")?.focus();
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-overlay p-4 py-10"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div ref={dialog} className="card w-full max-w-2xl p-6" role="dialog" aria-modal="true" aria-label="Новий лід">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="display text-[22px]">Новий лід</h2>
            <p className="mt-1 text-[12.5px] text-faint">
              Для лідів не з форм Meta: дзвінок, рекомендація, повідомлення в дірект. У вартість реклами такі ліди не рахуються.
            </p>
          </div>
          <button onClick={onClose} className="text-faint hover:text-text" aria-label="Закрити">
            <X size={18} />
          </button>
        </div>

        <form action={action} className="mt-5 flex flex-col gap-3">
          {/* The browser knows the viewer's timezone, so the server gets an exact moment. */}
          <input type="hidden" name="createdTimeIso" value={v.created ? new Date(v.created).toISOString() : ""} />

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Імʼя">
              <input name="fullName" className="input w-full" placeholder="Як звертатися" value={v.fullName} onChange={(e) => set("fullName", e.target.value)} />
            </Field>
            <Field label="Телефон" hint="телефон або пошта — обовʼязково">
              <input name="phone" className="input w-full" inputMode="tel" placeholder="+971…" value={v.phone} onChange={(e) => set("phone", e.target.value)} />
            </Field>
            <Field label="Пошта">
              <input name="email" className="input w-full" inputMode="email" placeholder="name@example.com" value={v.email} onChange={(e) => set("email", e.target.value)} />
            </Field>
            <Field label="Місто">
              <input name="city" className="input w-full" placeholder="Dubai" value={v.city} onChange={(e) => set("city", e.target.value)} />
            </Field>
            <Field label="Регіон">
              <select name="region" className="input w-full" value={v.region} onChange={(e) => set("region", e.target.value)}>
                <option value="">не вказано</option>
                {regions.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Звідки лід">
              <select name="platform" className="input w-full" value={v.platform} onChange={(e) => set("platform", e.target.value)}>
                {LEAD_PLATFORMS.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Відповідальний">
              <select name="owner" className="input w-full" value={v.owner} onChange={(e) => set("owner", e.target.value)}>
                <option value="">не призначено</option>
                {ownerList.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Статус">
              <select name="status" className="input w-full" value={v.status} onChange={(e) => set("status", e.target.value)}>
                {STATUSES.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Що цікавить">
            <input
              name="interest"
              className="input w-full"
              placeholder="Вілла в Dubai Hills, дизайн + реалізація"
              value={v.interest}
              onChange={(e) => set("interest", e.target.value)}
            />
          </Field>
          <Field label="Коли звернувся" hint="за потреби поставте минулу дату">
            <input
              type="datetime-local"
              name="created"
              className="input w-full sm:w-64"
              value={v.created}
              max={localNow()}
              onChange={(e) => set("created", e.target.value)}
            />
          </Field>
          <Field label="Коментар">
            <textarea
              name="comment"
              rows={2}
              className="input w-full resize-y"
              placeholder="Про що домовились, наступний крок…"
              value={v.comment}
              onChange={(e) => set("comment", e.target.value)}
            />
          </Field>

          {state?.message && (
            <p className="text-[12.5px] text-bad">
              {state.message}
              {state.duplicateId && (
                <>
                  {" "}
                  <Link href={`/crm/${state.duplicateId}`} className="text-accent underline-offset-2 hover:underline">
                    відкрити його
                  </Link>
                </>
              )}
            </p>
          )}
          {state?.duplicateId && (
            <label className="flex items-center gap-2 text-[12.5px] text-muted">
              <input type="checkbox" name="force" value="1" checked={v.force} onChange={(e) => set("force", e.target.checked)} /> Це інша людина — все одно
              створити
            </label>
          )}

          <div className="mt-2 flex items-center gap-2">
            <button className="btn btn-accent" disabled={pending}>
              {pending ? "Зберігаю…" : "Створити ліда"}
            </button>
            <button type="button" className="btn" onClick={onClose} disabled={pending}>
              Скасувати
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[12px] text-muted">
      <span>
        {label}
        {hint && <span className="ml-1.5 text-faint">· {hint}</span>}
      </span>
      {children}
    </label>
  );
}
