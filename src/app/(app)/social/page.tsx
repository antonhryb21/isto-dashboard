import { Suspense } from "react";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { Bookmark, ChevronLeft, ChevronRight, ExternalLink, Eye, Heart, ImageIcon, MessageCircle, Play, Send, ThumbsUp, Zap } from "lucide-react";
import { db } from "@/db";
import { competitors } from "@/db/schema";
import { META } from "@/lib/config";
import { minutesSince } from "@/lib/dates";
import { parseFilters } from "@/lib/filters";
import { followers, socialPage, socialTotals } from "@/lib/queries";
import { fmtCompact, fmtDate, fmtInt } from "@/lib/format";
import { FilterBar } from "@/components/filter-bar";
import { Kpi, SectionTitle } from "@/components/kpi";

type SP = Promise<Record<string, string | string[] | undefined>>;
type Post = Awaited<ReturnType<typeof socialPage>>["rows"][number];

const TYPE_LABEL: Record<string, string> = { post: "Пост", carousel: "Карусель", reel: "Reels", video: "Відео" };
const PER_PAGE = 9;
const IG_URL = "https://www.instagram.com/isto_architecture/";
const FB_URL = `https://www.facebook.com/${META.pageId}`;

export default async function SocialPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const f = parseFilters(sp);
  const pageOf = (k: string) => Math.max(1, Number(typeof sp[k] === "string" ? sp[k] : 1) || 1);
  const [fb, ig, t, tPrev, fol, [own]] = await Promise.all([
    socialPage(f, "fb", pageOf("fbp"), PER_PAGE),
    socialPage(f, "ig", pageOf("igp"), PER_PAGE),
    socialTotals(f),
    socialTotals(f, f.prevFrom, f.prevTo),
    followers(),
    db.select({ pic: competitors.profilePictureUrl }).from(competitors).where(eq(competitors.isOwn, true)).limit(1),
  ]);
  const qs = (patch: Record<string, string | number | null>) => {
    const next = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === 1) next.delete(k);
      else next.set(k, String(v));
    }
    return `?${next}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle title="Соцмережі" sub="Пости Facebook та Instagram ISTO з охопленням і реакціями. ⚡ — пост просувався рекламою." />
      <Suspense>
        <FilterBar regions={[]} showRegion={false} showPlatform={false} showType showSearch searchPlaceholder="Текст поста" />
      </Suspense>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Публікацій" value={fmtInt(t.posts)} current={t.posts} previous={tPrev.posts} />
        <Kpi label="Охоплення" value={fmtCompact(t.reach)} current={t.reach} previous={tPrev.reach} />
        <Kpi label="Збереження" value={fmtInt(t.saves)} current={t.saves} previous={tPrev.saves} />
        <Kpi label="Переходи в профіль" value={fmtInt(t.profileVisits)} current={t.profileVisits} previous={tPrev.profileVisits} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Column
          platform="fb"
          title="Facebook · ISTO"
          account="ISTO"
          stats={`${fol.fb?.followers ? fmtInt(fol.fb.followers) : "—"} підписників · ${fmtInt(fb.total)} постів за період`}
          url={FB_URL}
          pic={own?.pic ?? null}
          data={fb}
          page={pageOf("fbp")}
          href={(p) => qs({ fbp: p })}
        />
        <Column
          platform="ig"
          title="Instagram · @isto_architecture"
          account="@isto_architecture"
          stats={`${fol.ig?.followers ? fmtInt(fol.ig.followers) : "—"} підписників · ${fol.ig?.mediaCount ? fmtInt(fol.ig.mediaCount) : "—"} постів`}
          url={IG_URL}
          pic={own?.pic ?? null}
          data={ig}
          page={pageOf("igp")}
          href={(p) => qs({ igp: p })}
        />
      </div>

      <p className="text-[12px] text-faint">
        Детальна статистика (охоплення, збереження, перегляди) оновлюється для постів за останні 30 днів; старіші зберігають останні відомі значення.
      </p>
    </div>
  );
}

function Column({
  platform,
  title,
  account,
  stats,
  url,
  pic,
  data,
  page,
  href,
}: {
  platform: "fb" | "ig";
  title: string;
  account: string;
  stats: string;
  url: string;
  pic: string | null;
  data: Awaited<ReturnType<typeof socialPage>>;
  page: number;
  href: (p: number) => string;
}) {
  const Icon = platform === "fb" ? ThumbsUp : ImageIcon;
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="card flex items-center gap-3 p-4">
        {pic ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={pic} alt="" className="size-11 rounded-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          <div className="size-11 rounded-full bg-panel-2" />
        )}
        <div className="min-w-0">
          <div className="truncate text-[15px] font-medium">{account}</div>
          <div className="truncate text-[12.5px] text-muted">{stats}</div>
        </div>
      </div>

      <div className="card flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-[16px] font-medium">
            <Icon size={16} className="text-muted" />
            {title}
            <a href={url} target="_blank" rel="noreferrer" className="text-faint hover:text-text" aria-label="Відкрити">
              <ExternalLink size={13} />
            </a>
          </h2>
          <a href={url} target="_blank" rel="noreferrer" className="btn">
            Перейти у {platform === "fb" ? "FB" : "IG"} <ExternalLink size={12} />
          </a>
        </div>

        <div className="flex items-center justify-between text-[12px] text-faint">
          <span>
            {fmtInt(data.total)} за період · стор. {Math.min(page, data.pages)}/{data.pages}
          </span>
          {data.pages > 1 && (
            <span className="flex gap-1">
              {page > 1 ? (
                <Link className="chip" href={href(page - 1)} aria-label="Попередня">
                  <ChevronLeft size={13} />
                </Link>
              ) : null}
              {page < data.pages ? (
                <Link className="chip" href={href(page + 1)} aria-label="Наступна">
                  <ChevronRight size={13} />
                </Link>
              ) : null}
            </span>
          )}
        </div>

        {data.rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-faint">Публікацій за цей період немає.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {data.rows.map((p) => (
              <PostCard key={p.id} p={p} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ageLabel(d: Date) {
  const days = Math.floor(minutesSince(d) / 1440);
  if (days < 1) return "сьогодні";
  if (days < 7) return `${days} дн`;
  return fmtDate(d);
}

function PostCard({ p }: { p: Post }) {
  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-md border border-line bg-panel">
      <a href={p.permalink ?? undefined} target="_blank" rel="noreferrer" className="relative block bg-panel-2">
        {p.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.thumbnailUrl} alt="" className="aspect-square w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <div className="grid aspect-square place-items-center text-[11px] text-faint">{TYPE_LABEL[p.contentType] ?? p.contentType}</div>
        )}
        <span className="absolute right-1.5 top-1.5 rounded bg-overlay px-1.5 py-0.5 text-[10.5px] text-white">{ageLabel(p.publishedAt)}</span>
        <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-overlay px-1.5 py-0.5 text-[10.5px] text-white">
          {(p.contentType === "reel" || p.contentType === "video") && <Play size={9} fill="white" />}
          {TYPE_LABEL[p.contentType] ?? p.contentType}
        </span>
        {p.boosted && (
          <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-[10.5px] font-medium text-accent-ink">
            <Zap size={10} /> бустився
          </span>
        )}
      </a>
      <div className="flex flex-1 flex-col p-2.5">
        {p.caption ? <p className="line-clamp-2 text-[12px] leading-snug">{p.caption}</p> : <p className="text-[12px] text-faint">Без підпису</p>}
        <div className="mt-auto grid grid-cols-3 gap-y-1 pt-2 text-[11px]">
          {/* Meta's new FB "unique viewers" often comes back 0 even when the post has views: show "—", not a misleading zero. */}
          <M
            icon={<Eye size={11} />}
            v={p.platform === "fb" && !p.reach && (p.views ?? 0) > 0 ? null : p.reach}
            title={p.platform === "fb" ? "Охоплення (унікальні глядачі). Meta поки часто не віддає його для постів сторінки" : "Охоплення"}
          />
          <M icon={<Heart size={11} />} v={p.likes} title="Вподобання" />
          <M icon={<MessageCircle size={11} />} v={p.comments} title="Коментарі" />
          {p.platform === "ig" ? (
            <M icon={<Bookmark size={11} />} v={p.saves} title="Збереження" />
          ) : (
            <span className="text-faint" title="Facebook не віддає збереження постів через API">
              <Bookmark size={11} className="inline" /> н/д
            </span>
          )}
          <M icon={<Send size={11} />} v={p.shares} title="Репости" />
          <M icon={<Play size={11} />} v={p.views} title="Перегляди" />
        </div>
      </div>
    </article>
  );
}

function M({ icon, v, title }: { icon: React.ReactNode; v: number | null; title: string }) {
  return (
    <span className="flex items-center gap-1 text-muted" title={title}>
      {icon}
      <span className="text-text">{v === null || v === undefined ? "—" : fmtCompact(v)}</span>
    </span>
  );
}
