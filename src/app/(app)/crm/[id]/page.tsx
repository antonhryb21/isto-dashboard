import Link from "next/link";
import { leadContact } from "@/lib/lead-contact";
import { leadFlags } from "@/lib/lead-flags";
import { platformLabel } from "@/lib/lead-source";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { hasRole, requireUser } from "@/lib/auth/current-user";
import { leadDetail, owners } from "@/lib/queries";
import { listRegions } from "@/lib/regions";
import { STATUS_BY_CODE, type StatusCode } from "@/lib/statuses";
import { fmtDate, fmtMoney } from "@/lib/format";
import { CommentForm, LeadForm, StatusBadge } from "@/components/crm-controls";

const label = (code: string | null) => (code ? STATUS_BY_CODE[code as StatusCode]?.label ?? code : "—");

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const user = await requireUser();
  const [data, ownerList, regions] = await Promise.all([leadDetail(id), owners(), listRegions()]);
  if (!data) notFound();
  const { lead, events, ad } = data;
  const canEdit = hasRole(user.role, "marketing");
  const region = regions.find((r) => r.code === lead.regionCode);
  const c = leadContact(lead);
  // Hints are for leads still being worked; once someone marked it as junk there is nothing to suggest.
  const flags = STATUS_BY_CODE[lead.status as StatusCode]?.stage === "junk" ? [] : leadFlags(lead);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <Link href="/crm" className="flex items-center gap-1 text-[13px] text-muted hover:text-text">
        <ArrowLeft size={14} /> До списку
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-semibold">{c.name || "Без імені"}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-[13px] text-muted">
            <StatusBadge status={lead.status} />
            <span>{fmtDate(lead.createdTime, true)}</span>
            {region && <span>{region.name}</span>}
            {lead.platform && <span>{platformLabel(lead.platform)}</span>}
            {lead.source === "manual" && <span className="text-faint">додано вручну</span>}
            {lead.dealAmount && <span className="text-accent">{fmtMoney(Number(lead.dealAmount), lead.dealCurrency ?? "AED")}</span>}
          </div>
        </div>
      </div>

      {flags.length > 0 && (
        <div className="card flex flex-col gap-1 border-warn/50 p-4 text-[13px]">
          {flags.map((fl) => (
            <div key={fl.code}>
              <span className="font-medium text-warn first-letter:uppercase">{fl.label}.</span> <span className="text-muted">{fl.hint}</span>
            </div>
          ))}
          <div className="text-[12px] text-faint">Це підказка, статус не змінено. Якщо підтверджується — оберіть {flags.map((fl) => label(fl.suggest)).join(" або ")}.</div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="flex flex-col gap-4">
          <section className="card p-5">
            <div className="label">Контакти</div>
            <dl className="mt-3 grid grid-cols-[120px_1fr] gap-y-2 text-[13.5px]">
              <dt className="text-muted">Імʼя</dt>
              <dd>{c.name ?? "—"}</dd>
              <dt className="text-muted">Телефон</dt>
              <dd>{c.phone ? <a href={`tel:${c.phone}`} className="hover:text-accent">{c.phone}</a> : "—"}
                {c.phone && (
                  <a className="ml-3 text-[12px] text-accent" href={`https://wa.me/${c.phone.replace(/[^\d]/g, "")}`} target="_blank" rel="noreferrer">WhatsApp</a>
                )}
              </dd>
              <dt className="text-muted">Пошта</dt>
              <dd>{c.email ? <a href={`mailto:${c.email}`} className="hover:text-accent">{c.email}</a> : "—"}</dd>
              <dt className="text-muted">Місто</dt>
              <dd>{c.city ?? "—"}</dd>
            </dl>
          </section>

          {Object.keys(c.interest).length > 0 && (
            <section className="card p-5">
              <div className="label">Відповіді з форми</div>
              <dl className="mt-3 grid grid-cols-[minmax(120px,40%)_1fr] gap-x-4 gap-y-2 text-[13.5px]">
                {Object.entries(c.interest).map(([q, a]) => (
                  <div key={q} className="contents">
                    <dt className="text-muted first-letter:uppercase">{q}</dt>
                    <dd>{a}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          <section className="card p-5">
            <div className="label">Історія і коментарі</div>
            {canEdit && (
              <div className="mt-3">
                <CommentForm id={lead.id} />
              </div>
            )}
            {lead.sheetComment && (
              <div className="mt-4 rounded-lg border border-line p-3 text-[13px]">
                <div className="text-[11.5px] text-faint">Коментар у Google Таблиці</div>
                <p className="mt-1 whitespace-pre-wrap">{lead.sheetComment}</p>
              </div>
            )}
            <ol className="mt-4 flex flex-col gap-3">
              {events.map((e) => (
                <li key={e.id} className="border-l-2 border-line pl-3 text-[13px]">
                  <div className="text-[11.5px] text-faint">
                    {fmtDate(e.createdAt, true)} · {authorLabel(e.author)}
                  </div>
                  <div className="mt-0.5">
                    {e.type === "comment" && <p className="whitespace-pre-wrap">{e.text}</p>}
                    {e.type === "created" && <>Лід створено</>}
                    {e.type === "status" && (
                      <>
                        Статус: {label(e.fromValue)} → <b>{label(e.toValue)}</b>
                      </>
                    )}
                    {e.type === "owner" && (
                      <>
                        Відповідальний: {e.fromValue ?? "—"} → <b>{e.toValue ?? "—"}</b>
                      </>
                    )}
                    {e.type === "next" && (
                      <>
                        Наступний контакт: {e.fromValue ?? "—"} → <b>{e.toValue ?? "—"}</b>
                      </>
                    )}
                    {e.type === "reason" && (
                      <>
                        Причина відмови: <b>{e.toValue ?? "—"}</b>
                      </>
                    )}
                    {e.type === "amount" && (
                      <>
                        Сума угоди: {e.fromValue ?? "—"} → <b>{e.toValue ?? "—"}</b>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="flex flex-col gap-4">
          {canEdit && (
            <section className="card p-5">
              <LeadForm
                id={lead.id}
                status={lead.status}
                owner={lead.owner}
                dealAmount={lead.dealAmount}
                dealCurrency={lead.dealCurrency ?? region?.currency ?? "AED"}
                nextContactAt={lead.nextContactAt}
                lostReason={lead.lostReason}
                owners={ownerList}
              />
            </section>
          )}
          <section className="card p-5 text-[12.5px]">
            <div className="label">Звідки лід</div>
            {ad?.thumbnailUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={ad.thumbnailUrl} alt="" className="mt-3 aspect-square w-full rounded-lg object-cover" />
            )}
            <dl className="mt-3 flex flex-col gap-2">
              <Row k="Кампанія" v={lead.source === "manual" ? `додано вручну · ${platformLabel(lead.platform) ?? "інше"}` : lead.isOrganic ? "органіка" : lead.campaignName} />
              <Row k="Група" v={lead.adsetName} />
              <Row k="Оголошення" v={lead.adName} />
              <Row k="Форма" v={lead.formName} />
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string | null }) {
  return (
    <div>
      <dt className="text-faint">{k}</dt>
      <dd className="break-words">{v ?? "—"}</dd>
    </div>
  );
}

function authorLabel(a: string | null) {
  if (!a) return "—";
  if (a === "sheet") return "Google Таблиця";
  if (a === "import") return "імпорт історії";
  if (a === "meta") return "Meta";
  if (a === "auto") return "автопризначення";
  if (a.startsWith("telegram:")) return `Telegram ${a.slice(9)}`;
  return a;
}
