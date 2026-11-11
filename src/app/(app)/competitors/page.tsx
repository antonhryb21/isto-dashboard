import { Suspense } from "react";
import Link from "next/link";
import { ExternalLink, Heart, MessageCircle, Play } from "lucide-react";
import { parseFilters } from "@/lib/filters";
import { explainError } from "@/lib/sync";
import { hasRole, requireUser } from "@/lib/auth/current-user";
import { adLibraryUrl, competitorTable, followersSeries, topCompetitorPosts, type CompetitorRow } from "@/lib/competitors";
import { ago, fmtCompact, fmtDate, fmtInt, fmtPct, fmtPctAuto, fmtRange, plural } from "@/lib/format";
import { FilterBar } from "@/components/filter-bar";
import { Empty, SectionTitle } from "@/components/kpi";
import { FollowersChart } from "@/components/charts";
import { SyncCompetitorsButton } from "@/components/competitor-controls";

type SP = Promise<Record<string, string | string[] | undefined>>;

const TYPE_LABEL: Record<string, string> = { post: "Пост", reel: "Reels", carousel: "Карусель", video: "Відео" };
const nf1 = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 });

export default async function CompetitorsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const f = parseFilters(sp);
  const user = await requireUser();
  const acc = typeof sp.acc === "string" ? sp.acc : null;

  const rows = await competitorTable(f);
  const [series, posts] = await Promise.all([
    followersSeries(
      f,
      rows.map((r) => r.username),
    ),
    topCompetitorPosts(f, { username: acc, type: f.type }),
  ]);
  const name = Object.fromEntries(rows.map((r) => [r.username, r.name]));
  const synced = rows.filter((r) => r.lastSyncedAt);
  const lastSynced = synced.length ? new Date(Math.max(...synced.map((r) => r.lastSyncedAt!.getTime()))) : null;
  const maxEr = Math.max(0, ...rows.map((r) => r.er ?? 0));
  const maxPerWeek = Math.max(0, ...rows.map((r) => r.perWeek));

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
        title="Конкуренти"
        sub={`Публічні дані Instagram і реклама в Meta Ad Library · оновлено ${ago(lastSynced)}`}
        right={hasRole(user.role, "marketing") ? <SyncCompetitorsButton /> : null}
      />
      <Suspense>
        <FilterBar regions={[]} showRegion={false} showPlatform={false} showType />
      </Suspense>

      {synced.length === 0 ? (
        <Empty>
          Даних ще немає. Натисніть «Оновити конкурентів». Потрібен токен Meta у Vercel (META_SYSTEM_USER_TOKEN), бо дані йдуть через Instagram-акаунт ISTO.
        </Empty>
      ) : (
        <>
          <div className="card overflow-x-auto">
            <table className="data lined">
              <thead>
                <tr>
                  <th>Акаунт</th>
                  <th className="num">Підписники</th>
                  <th className="num" title="Зміна підписників за період: скільки людей і скільки це відсотків від початкової кількості">
                    Приріст
                  </th>
                  <th className="num">Постів</th>
                  <th>На тиждень</th>
                  <th className="num">Лайки · коменти</th>
                  <th>ER на пост</th>
                  <th className="num">Reels · карусел.</th>
                  <th>Реклама</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.username} className={r.isOwn ? "bg-panel-2" : ""}>
                    <td>
                      <Account r={r} />
                    </td>
                    <td className="num metric">{r.followers !== null ? fmtInt(r.followers) : "—"}</td>
                    <td className="num">
                      {r.growth === null ? (
                        <span className="text-faint" title="Потрібно щонайменше два дні даних">
                          —
                        </span>
                      ) : (
                        <span
                          title={
                            r.growthFrom && r.growthTo
                              ? `${fmtRange(r.growthFrom, r.growthTo)} · ${r.growthDays} ${plural(r.growthDays ?? 0, ["день", "дні", "днів"])} даних`
                              : undefined
                          }
                        >
                          <span className={r.growth >= 0 ? "text-good" : "text-bad"}>
                            {r.growth > 0 ? "+" : ""}
                            {fmtInt(r.growth)}
                          </span>
                          {/* The sign is already on the number itself, so the share goes in brackets without one. */}
                          {r.growthPct !== null && <span className="ml-1.5 text-[11.5px] text-muted">({fmtPctAuto(Math.abs(r.growthPct))})</span>}
                        </span>
                      )}
                    </td>
                    <td className="num">{fmtInt(r.posts)}</td>
                    <td>
                      <Bar value={r.perWeek} max={maxPerWeek} label={nf1.format(r.perWeek)} own={r.isOwn} />
                    </td>
                    <td className="num" title="Середнє на пост">
                      {r.hiddenLikes ? <span className="text-faint" title="Акаунт приховує лайки">приховані</span> : r.avgLikes !== null ? fmtInt(r.avgLikes) : "—"}
                      <span className="text-faint"> · </span>
                      {r.avgComments !== null ? nf1.format(r.avgComments) : "—"}
                    </td>
                    <td>{r.er !== null ? <Bar value={r.er} max={maxEr} label={fmtPct(r.er, 2)} own={r.isOwn} /> : <span className="text-faint">—</span>}</td>
                    <td className="num text-muted">
                      {r.reelsShare !== null ? `${fmtPct(r.reelsShare, 0)} · ${fmtPct(r.carouselShare ?? 0, 0)}` : "—"}
                    </td>
                    <td>
                      <div className="flex flex-col gap-0.5">
                        {(r.adLibraryPageIds.length ? r.adLibraryPageIds : [null]).map((id, i) => (
                          <a
                            key={id ?? "q"}
                            href={adLibraryUrl({ name: r.name, adLibraryPageIds: id ? [id] : [] })}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1 whitespace-nowrap text-[12px] text-muted hover:text-text"
                            title={id ? "Активна реклама в Meta Ad Library" : "Пошук за назвою в Meta Ad Library"}
                          >
                            {id ? (r.adLibraryPageIds.length > 1 ? `Ad Library ${i + 1}` : "Ad Library") : "пошук"} <ExternalLink size={11} />
                          </a>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Приріст підписників, % від початку періоду</h2>
              <span className="text-[12px] text-faint">Instagram не дає історію підписників — графік накопичується щодня з моменту підключення</span>
            </div>
            {series.length < 2 ? (
              <p className="py-10 text-center text-sm text-faint">Графік з&apos;явиться, коли буде щонайменше два дні даних.</p>
            ) : (
              <FollowersChart data={series} series={rows.map((r) => ({ key: r.username, name: r.name, own: r.isOwn }))} />
            )}
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="display text-[22px]">
                Найкращі пости <em className="serif">за період</em>
              </h2>
              <div className="flex flex-wrap gap-1">
                <Link className="chip" data-active={!acc} href={qs({ acc: null })}>
                  Усі
                </Link>
                {rows.map((r) => (
                  <Link key={r.username} className="chip" data-active={acc === r.username} href={qs({ acc: r.username })}>
                    {r.name}
                  </Link>
                ))}
              </div>
            </div>
            {posts.length === 0 ? (
              <Empty>Постів за цей період немає.</Empty>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-6">
                {posts.map(({ competitor_posts: p }) => (
                  <article key={p.id} className="card flex flex-col overflow-hidden">
                    <a href={p.permalink ?? undefined} target="_blank" rel="noreferrer" className="relative block bg-panel-2">
                      {p.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.thumbnailUrl} alt="" className="aspect-[4/5] w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="grid aspect-[4/5] place-items-center text-[12px] text-faint">{TYPE_LABEL[p.contentType]}</div>
                      )}
                      <span className="absolute left-2 top-2 rounded-full bg-overlay px-2 py-0.5 text-[11px] text-white">
                        {name[p.username] ?? p.username} · {TYPE_LABEL[p.contentType] ?? p.contentType}
                      </span>
                      {(p.contentType === "reel" || p.contentType === "video") && (
                        <span className="absolute right-2 top-2 rounded-full bg-overlay p-1.5">
                          <Play size={12} fill="white" color="white" />
                        </span>
                      )}
                    </a>
                    <div className="flex flex-1 flex-col p-3">
                      <div className="text-[11.5px] text-faint">{fmtDate(p.publishedAt)}</div>
                      {p.caption && <p className="mt-1 line-clamp-2 text-[12.5px] text-muted">{p.caption}</p>}
                      <div className="mt-auto flex gap-4 pt-3 text-[12px] text-muted">
                        <span className="flex items-center gap-1" title="Вподобання">
                          <Heart size={12} />
                          <span className="text-text">{p.likes === null ? "—" : fmtCompact(p.likes)}</span>
                        </span>
                        <span className="flex items-center gap-1" title="Коментарі">
                          <MessageCircle size={12} />
                          <span className="text-text">{p.comments === null ? "—" : fmtCompact(p.comments)}</span>
                        </span>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <p className="text-[12px] text-faint">
        Instagram відкриває про чужі акаунти лише підписників, лайки й коментарі; охоплення, збереження і перегляди бачить тільки власник. ER на пост =
        (лайки + коментарі) ÷ підписники. Скільки конкуренти витрачають на рекламу, Meta не показує нікому — в Ad Library видно лише самі оголошення.
      </p>
    </div>
  );
}

function Account({ r }: { r: CompetitorRow }) {
  return (
    <div className="flex items-center gap-2.5">
      {r.profilePictureUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={r.profilePictureUrl} alt="" className="size-8 rounded-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        <div className="size-8 rounded-full bg-panel-2" />
      )}
      <div>
        <div className="font-medium">
          {r.name}
          {r.isOwn && <span className="ml-1.5 rounded-full bg-accent px-1.5 py-px text-[10px] text-accent-ink">ми</span>}
        </div>
        <a href={`https://www.instagram.com/${r.username}/`} target="_blank" rel="noreferrer" className="text-[11.5px] text-faint hover:text-text">
          @{r.username}
        </a>
        {r.lastError && (
          <div className="max-w-56 truncate text-[11px] text-bad" title={explainError(r.lastError)}>
            не вдалося оновити
          </div>
        )}
      </div>
    </div>
  );
}

function Bar({ value, max, label, own }: { value: number; max: number; label: string; own: boolean }) {
  const w = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div className="flex min-w-24 items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-panel-2">
        <div className={`h-1.5 rounded-full ${own ? "bg-data-1" : "bg-data-1/40"}`} style={{ width: `${w}%` }} />
      </div>
      <span className="w-11 text-right text-[12.5px] tabular-nums">{label}</span>
    </div>
  );
}
