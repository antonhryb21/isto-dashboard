import { Suspense } from "react";
import Link from "next/link";
import { parseFilters } from "@/lib/filters";
import { listRegions } from "@/lib/regions";
import { hasRole, requireUser } from "@/lib/auth/current-user";
import { leadList, owners, responseSpeed, statusCounts } from "@/lib/queries";
import { STATUSES } from "@/lib/statuses";
import { fmtDate, fmtInt, fmtMinutes } from "@/lib/format";
import { FilterBar } from "@/components/filter-bar";
import { Empty, Kpi, SectionTitle } from "@/components/kpi";
import { StatusBadge, StatusSelect } from "@/components/crm-controls";

type SP = Promise<Record<string, string | string[] | undefined>>;

const BOARD = STATUSES.filter((s) => s.stage !== "junk");

export default async function CrmPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const f = parseFilters(sp);
  const user = await requireUser();
  const canEdit = hasRole(user.role, "marketing");
  const view = sp.view === "board" ? "board" : "list";
  const status = typeof sp.status === "string" ? sp.status : null;
  const owner = typeof sp.owner === "string" ? sp.owner : null;

  const [regions, list, counts, speed, ownerList] = await Promise.all([
    listRegions(),
    leadList(f, { status: view === "list" ? status : null, owner }),
    statusCounts(f),
    responseSpeed(f),
    owners(),
  ]);
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
        sub="Ліди з усіх регіональних таблиць. Зміна статусу або відповідального одразу записується в Google Таблицю."
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
        <Kpi label="Чекають контакту" value={fmtInt(counts.new ?? 0)} hint="статус New" accent={(counts.new ?? 0) > 0} />
        <Kpi label="Медіана реакції" value={fmtMinutes(speed.medianMinutes)} hint={`виміряно для ${speed.measured}`} />
        <Kpi label="Угоди" value={fmtInt(counts.won ?? 0)} />
      </div>

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
        {ownerList.length > 0 && (
          <span className="ml-2 flex flex-wrap items-center gap-1 text-[12px] text-faint">
            Відповідальний:
            <Link className="chip" data-active={!owner} href={qs({ owner: null })}>
              усі
            </Link>
            {ownerList.map((o) => (
              <Link key={o} className="chip" data-active={owner === o} href={qs({ owner: o })}>
                {o}
              </Link>
            ))}
          </span>
        )}
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
                  <td className="whitespace-nowrap text-muted">{fmtDate(l.createdTime, true)}</td>
                  <td>
                    <Link href={`/crm/${l.id}`} className="font-medium hover:text-accent">
                      {l.fullName || l.email || l.phone || "Без імені"}
                    </Link>
                    <div className="text-[11.5px] text-faint">
                      {[l.phone, l.city].filter(Boolean).join(" · ")}
                    </div>
                  </td>
                  <td className="text-muted">{l.regionCode ? regionName[l.regionCode] ?? l.regionCode : "—"}</td>
                  <td className="max-w-64 truncate text-muted" title={Object.values(l.answers).join(" · ")}>
                    {Object.values(l.answers).slice(0, 2).join(" · ") || "—"}
                  </td>
                  <td className="max-w-56 truncate text-[12px] text-faint" title={l.campaignName ?? ""}>
                    {l.isOrganic ? "органіка" : l.campaignName ?? "—"}
                  </td>
                  <td className="text-muted">{l.owner ?? "—"}</td>
                  <td>
                    <StatusSelect id={l.id} status={l.status} disabled={!canEdit} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
                      <div className="truncate text-[13px] font-medium">{l.fullName || l.email || l.phone || "Без імені"}</div>
                      <div className="mt-0.5 text-[11.5px] text-faint">
                        {fmtDate(l.createdTime)} · {l.regionCode ? regionName[l.regionCode] ?? l.regionCode : "—"}
                        {l.owner ? ` · ${l.owner}` : ""}
                      </div>
                      {Object.values(l.answers)[0] && (
                        <div className="mt-1.5 line-clamp-2 text-[12px] text-muted">{Object.values(l.answers).slice(0, 2).join(" · ")}</div>
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
    </div>
  );
}
