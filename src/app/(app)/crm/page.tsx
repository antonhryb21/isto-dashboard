import { Suspense } from "react";
import Link from "next/link";
import { parseFilters } from "@/lib/filters";
import { listRegions } from "@/lib/regions";
import { hasRole, requireUser } from "@/lib/auth/current-user";
import { MessageCircle } from "lucide-react";
import { dueFollowUps, leadList, lostReasons, overdueLeads, ownerLabel, ownerSpeed, owners, responseSpeed, statusCounts } from "@/lib/queries";
import { SLA_MINUTES } from "@/lib/config";
import { localDate } from "@/lib/dates";
import { businessMinutes, isOverdue, workTimeLabel } from "@/lib/sla";
import { leadFlags } from "@/lib/lead-flags";
import { STATUSES } from "@/lib/statuses";
import { fmtDate, fmtInt, fmtPct, plural } from "@/lib/format";
import { FilterBar } from "@/components/filter-bar";
import { Empty, Kpi, SectionTitle } from "@/components/kpi";
import { OwnerSelect, StatusBadge, StatusSelect } from "@/components/crm-controls";
import { leadContact } from "@/lib/lead-contact";

type SP = Promise<Record<string, string | string[] | undefined>>;

const BOARD = STATUSES.filter((s) => s.stage !== "junk");
const PER_PAGE = 100;
/** Working time as "25 хв" / "3,5 роб. год". */
const fmtWork = (m: number) => (m < 60 ? `${m} хв` : `${(m / 60).toLocaleString("uk-UA", { maximumFractionDigits: 1 })} роб. год`);

export default async function CrmPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const f = parseFilters(sp);
  const user = await requireUser();
  const canEdit = hasRole(user.role, "marketing");
  const view = sp.view === "board" ? "board" : "list";
  const status = typeof sp.status === "string" ? sp.status : null;
  const owner = typeof sp.owner === "string" ? sp.owner : null;
  const overdueOnly = sp.overdue === "1";
  const dueOnly = sp.due === "1";
  const special = overdueOnly || dueOnly;
  const page = Math.max(1, Number(sp.lp) || 1);
  const me = ownerLabel(user);

  const [regions, all, counts, speed, ownerList, overdue, byOwner, due, reasons] = await Promise.all([
    listRegions(),
    leadList(f, { status: view === "list" && !special ? status : null, owner, overdue: overdueOnly, due: dueOnly, limit: 2000 }),
    statusCounts(f),
    responseSpeed(f),
    owners(),
    overdueLeads(f.region),
    ownerSpeed(f),
    dueFollowUps(f.region),
    lostReasons(f),
  ]);
  const pages = Math.max(1, Math.ceil(all.length / PER_PAGE));
  const list = view === "list" ? all.slice((Math.min(page, pages) - 1) * PER_PAGE, Math.min(page, pages) * PER_PAGE) : all;
  const today = localDate();
  const unassigned = byOwner.find((o) => !o.owner)?.total ?? 0;
  const regionName = Object.fromEntries(regions.map((r) => [r.code, r.name]));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const qs = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    return `?${next}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle
        title="CRM · ліди"
        sub="Усі ліди ISTO: нові приходять з Meta, статуси змінюються тут або кнопками Telegram-бота."
        right={
          <div className="flex gap-1">
            <Link className="chip" data-active={view === "list"} href={qs({ view: null })}>
              Список
            </Link>
            <Link className="chip" data-active={view === "board"} href={qs({ view: "board" })}>
              Дошка
            </Link>
          </div>
        }
      />
      <Suspense>
        <FilterBar regions={regions.map((r) => ({ value: r.code, label: r.name }))} showSearch searchPlaceholder="Ім'я, телефон, email, місто" />
      </Suspense>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Лідів за період" value={fmtInt(total)} />
        <Kpi
          label="Чекають контакту"
          value={fmtInt(counts.new ?? 0)}
          hint={overdue.length ? `${overdue.length} довше ${SLA_MINUTES} хв робочого часу` : "статус New"}
          accent={(counts.new ?? 0) > 0}
        />
        <Kpi label="Медіана реакції" value={speed.medianMinutes === null ? "—" : fmtWork(Math.round(speed.medianMinutes))} hint={`робочий час · виміряно для ${speed.measured}`} />
        <Kpi label="Угоди" value={fmtInt(counts.won ?? 0)} />
      </div>

      {overdue.length > 0 && (
        <div className="card flex flex-wrap items-center justify-between gap-3 border-bad/50 p-4">
          <div className="text-sm">
            <span className="font-medium text-bad">
              {overdue.length} {plural(overdue.length, ["лід чекає", "ліди чекають", "лідів чекають"])} контакту довше {SLA_MINUTES} хв робочого часу.
            </span>{" "}
            <span className="text-muted">
              Найдовше — {fmtWork(businessMinutes(overdue[0].createdTime))}
              {overdue[0].fullName ? ` (${overdue[0].fullName})` : ""}. Робочий час: {workTimeLabel()}.
            </span>
          </div>
          <Link className="btn" href={overdueOnly ? qs({ overdue: null, lp: null }) : qs({ overdue: "1", due: null, view: null, status: null, lp: null })}>
            {overdueOnly ? "Показати всі" : "Показати прострочені"}
          </Link>
        </div>
      )}

      {(due.length > 0 || dueOnly) && (
        <div className="card flex flex-wrap items-center justify-between gap-3 border-warn/50 p-4">
          <div className="text-sm">
            <span className="font-medium text-warn">
              {due.length} {plural(due.length, ["нагадування", "нагадування", "нагадувань"])} про повторний контакт на сьогодні або раніше.
            </span>
          </div>
          <Link className="btn" href={dueOnly ? qs({ due: null, lp: null }) : qs({ due: "1", overdue: null, view: null, status: null, lp: null })}>
            {dueOnly ? "Показати всі" : "Показати нагадування"}
          </Link>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1">
        {view === "list" && (
          <Link className="chip" data-active={!status} href={qs({ status: null })}>
            Усі · {total}
          </Link>
        )}
        {view === "list" &&
          STATUSES.map((s) => (
            <Link key={s.code} className="chip" data-active={status === s.code} href={qs({ status: s.code })}>
              {s.label} · {counts[s.code] ?? 0}
            </Link>
          ))}
      </div>
      <div className="-mt-3 flex flex-wrap items-center gap-1 text-[12px] text-faint">
        Відповідальний:
        <Link className="chip" data-active={!owner} href={qs({ owner: null, lp: null })}>
          усі
        </Link>
        <Link className="chip" data-active={owner === me} href={qs({ owner: me, lp: null })}>
          мої
        </Link>
        <Link className="chip" data-active={owner === "-"} href={qs({ owner: "-", lp: null })}>
          не призначено{unassigned ? ` · ${unassigned}` : ""}
        </Link>
        {ownerList
          .filter((o) => o !== me)
          .map((o) => (
            <Link key={o} className="chip" data-active={owner === o} href={qs({ owner: o, lp: null })}>
              {o}
            </Link>
          ))}
      </div>

      {list.length === 0 ? (
        <Empty>Лідів за цими фільтрами немає.</Empty>
      ) : view === "list" ? (
        <div className="card overflow-x-auto">
          <table className="data">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Лід</th>
                <th>Регіон</th>
                <th>Що цікавить</th>
                <th>Кампанія</th>
                <th>Відповідальний</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {list.map((l) => (
                <tr key={l.id}>
                  <td className="whitespace-nowrap text-muted">
                    {fmtDate(l.createdTime, true)}
                    {l.status === "new" && isOverdue(l.createdTime) && (
                      <div className="text-[11px] font-medium text-bad">чекає {fmtWork(businessMinutes(l.createdTime))}</div>
                    )}
                  </td>
                  <td>
                    <LeadContact l={l} />
                  </td>
                  <td className="text-muted">{l.regionCode ? regionName[l.regionCode] ?? l.regionCode : "—"}</td>
                  <td className="max-w-44 truncate text-muted" title={Object.values(leadContact(l).interest).join(" · ")}>
                    {Object.values(leadContact(l).interest).slice(0, 2).join(" · ") || "—"}
                  </td>
                  <td className="max-w-40 truncate text-[12px] text-faint" title={l.campaignName ?? ""}>
                    {l.isOrganic ? "органіка" : l.campaignName ?? "—"}
                  </td>
                  <td>
                    <OwnerSelect id={l.id} owner={l.owner} owners={ownerList} disabled={!canEdit} />
                  </td>
                  <td className="pr-4">
                    <StatusSelect id={l.id} status={l.status} disabled={!canEdit} />
                    {l.nextContactAt && (
                      <div className={`mt-1 text-[11px] ${l.nextContactAt <= today ? "font-medium text-warn" : "text-faint"}`}>
                        контакт {fmtDate(new Date(l.nextContactAt + "T12:00:00Z"))}
                      </div>
                    )}
                    {l.lostReason && <div className="mt-1 max-w-36 truncate text-[11px] text-faint" title={l.lostReason}>{l.lostReason}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 text-[12px] text-faint">
              <span>
                {fmtInt(all.length)} {plural(all.length, ["лід", "ліди", "лідів"])} · стор. {Math.min(page, pages)}/{pages}
              </span>
              <span className="flex gap-1">
                {page > 1 && (
                  <Link className="chip" href={qs({ lp: page - 1 > 1 ? String(page - 1) : null })}>
                    ← новіші
                  </Link>
                )}
                {page < pages && (
                  <Link className="chip" href={qs({ lp: String(page + 1) })}>
                    старіші →
                  </Link>
                )}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {BOARD.map((s) => {
            const items = list.filter((l) => l.status === s.code);
            return (
              <div key={s.code} className="w-64 shrink-0">
                <div className="mb-2 flex items-center justify-between px-1">
                  <StatusBadge status={s.code} />
                  <span className="text-[12px] text-faint">{items.length}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {items.slice(0, 60).map((l) => (
                    <Link key={l.id} href={`/crm/${l.id}`} className="card block p-3 hover:border-faint">
                      <div className="truncate text-[13px] font-medium">{leadContact(l).name || "Без імені"}</div>
                      {leadContact(l).phone && <div className="truncate text-[11.5px] text-muted">{leadContact(l).phone}</div>}
                      <div className="mt-0.5 text-[11.5px] text-faint">
                        {fmtDate(l.createdTime)} · {l.regionCode ? regionName[l.regionCode] ?? l.regionCode : "—"}
                        {l.owner ? ` · ${l.owner}` : ""}
                      </div>
                      {Object.values(leadContact(l).interest)[0] && (
                        <div className="mt-1.5 line-clamp-2 text-[12px] text-muted">{Object.values(leadContact(l).interest).slice(0, 2).join(" · ")}</div>
                      )}
                    </Link>
                  ))}
                  {items.length > 60 && <div className="px-1 text-[12px] text-faint">ще {items.length - 60}…</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {reasons.length > 0 && (
        <div className="card p-5">
          <div className="label">Причини відмов за період</div>
          <div className="mt-3 flex flex-wrap gap-2 text-[13px]">
            {reasons.map((r) => (
              <span key={r.reason ?? "-"} className="chip">
                {r.reason ?? <span className="text-bad">причину не вказано</span>} · {r.n}
              </span>
            ))}
          </div>
        </div>
      )}

      {byOwner.some((o) => o.owner) && (
        <div className="card overflow-x-auto">
          <div className="label px-5 pt-4">Швидкість реакції по відповідальних</div>
          <table className="data mt-2">
            <thead>
              <tr>
                <th>Відповідальний</th>
                <th className="num">Лідів</th>
                <th className="num">Звʼязались</th>
                <th className="num">Медіана реакції</th>
                <th className="num">Вчасно (≤ {SLA_MINUTES} хв)</th>
                <th className="num">Чекають</th>
              </tr>
            </thead>
            <tbody>
              {byOwner.map((o) => (
                <tr key={o.owner ?? "-"}>
                  <td>{o.owner ?? <span className="text-faint">не призначено</span>}</td>
                  <td className="num">{fmtInt(o.total)}</td>
                  <td className="num">{fmtInt(o.contacted)}</td>
                  <td className="num">{o.medianMinutes === null ? "—" : fmtWork(Math.round(o.medianMinutes))}</td>
                  <td className="num">
                    {o.slaShare === null ? "—" : <span className={o.slaShare >= 0.8 ? "text-good" : o.slaShare < 0.5 ? "text-bad" : ""}>{fmtPct(o.slaShare, 0)}</span>}
                  </td>
                  <td className={`num ${o.waiting ? "text-bad" : ""}`}>{fmtInt(o.waiting)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Name, phone, email and city — one per line, as the team reads them. */
function LeadContact({ l }: { l: Parameters<typeof leadFlags>[0] & { id: string } }) {
  const c = leadContact(l);
  const flags = leadFlags(l);
  return (
    <div className="flex min-w-48 flex-col leading-snug">
      <Link href={`/crm/${l.id}`} className="font-medium hover:text-accent">
        {c.name || <span className="text-faint">Без імені</span>}
      </Link>
      {c.phone && (
        <span className="flex items-center gap-1.5 text-[12px] text-muted">
          <a href={`tel:${c.phone}`} className="hover:text-text">
            {c.phone}
          </a>
          <a
            href={`https://wa.me/${c.phone.replace(/[^\d]/g, "")}`}
            target="_blank"
            rel="noreferrer"
            title="Написати у WhatsApp"
            className="text-faint hover:text-good"
          >
            <MessageCircle size={12} />
          </a>
        </span>
      )}
      {c.email && <span className="break-all text-[12px] text-muted">{c.email}</span>}
      {c.city && <span className="text-[12px] text-faint">{c.city}</span>}
      {flags.length > 0 && (
        <span className="mt-1 flex flex-wrap gap-1">
          {flags.map((fl) => (
            <span key={fl.code} title={fl.hint} className="rounded-full border border-warn/50 px-1.5 py-px text-[10.5px] text-warn">
              {fl.label}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}
