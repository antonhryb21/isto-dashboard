import Link from "next/link";
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

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <Link href="/crm" className="flex items-center gap-1 text-[13px] text-muted hover:text-text">
        <ArrowLeft size={14} /> До списку
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-semibold">{lead.fullName || lead.email || lead.phone || "Без імені"}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-[13px] text-muted">
            <StatusBadge status={lead.status} />
            <span>{fmtDate(lead.createdTime, true)}</span>
            {region && <span>{region.name}</span>}
            {lead.platform && <span>{lead.platform === "ig" ? "Instagram" : lead.platform === "fb" ? "Facebook" : lead.platform}</span>}
            {lead.dealAmount && <span className="text-accent">{fmtMoney(Number(lead.dealAmount), lead.dealCurrency ?? "AED")}</span>}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="flex flex-col gap-4">
          <section className="card p-5">
            <div className="label">Контакти</div>
            <dl className="mt-3 grid grid-cols-[120px_1fr] gap-y-2 text-[13.5px]">
              <dt className="text-muted">Телефон</dt>
              <dd>{lead.phone ? <a href={`tel:${lead.phone}`} className="hover:text-accent">{lead.phone}</a> : "—"}
                {lead.phone && (
                  <a className="ml-3 text-[12px] text-accent" href={`https://wa.me/${lead.phone.replace(/[^\d]/g, "")}`} target="_blank" rel="noreferrer">WhatsApp</a>
                )}
              </dd>
              <dt className="text-muted">Email</dt>
              <dd>{lead.email ? <a href={`mailto:${lead.email}`} className="hover:text-accent">{lead.email}</a> : "—"}</dd>
              <dt className="text-muted">Місто</dt>
              <dd>{lead.city ?? "—"}</dd>
            </dl>
          </section>

          {Object.keys(lead.answers).length > 0 && (
            <section className="card p-5">
              <div className="label">Відповіді з форми</div>
              <dl className="mt-3 grid grid-cols-[minmax(120px,40%)_1fr] gap-x-4 gap-y-2 text-[13.5px]">
                {Object.entries(lead.answers).map(([q, a]) => (
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
                    {fmtDate(e.createdAt, true)} · {e.author === "sheet" ? "таблиця / бот" : e.author === "meta" ? "Meta" : e.author}
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
              <Row k="Кампанія" v={lead.isOrganic ? "органіка" : lead.campaignName} />
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
