import { Suspense } from "react";
import { Bookmark, Eye, Heart, MessageCircle, Play, Send, Zap } from "lucide-react";
import { parseFilters } from "@/lib/filters";
import { followers, socialList, socialTotals } from "@/lib/queries";
import { fmtCompact, fmtDate, fmtInt } from "@/lib/format";
import { FilterBar } from "@/components/filter-bar";
import { Empty, Kpi, SectionTitle } from "@/components/kpi";

type SP = Promise<Record<string, string | string[] | undefined>>;

const TYPE_LABEL: Record<string, string> = { post: "Пост", carousel: "Карусель", reel: "Reels", video: "Відео" };

export default async function SocialPage({ searchParams }: { searchParams: SP }) {
  const f = parseFilters(await searchParams);
  const [posts, t, tPrev, fol] = await Promise.all([
    socialList(f),
    socialTotals(f),
    socialTotals(f, f.prevFrom, f.prevTo),
    followers(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle title="Соцмережі" sub="Пости Instagram і Facebook ISTO з охопленням і реакціями. ⚡ — пост просувався рекламою." />
      <Suspense>
        <FilterBar regions={[]} showRegion={false} showType showSearch searchPlaceholder="Текст поста" />
      </Suspense>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Kpi label="Підписники IG" value={fol.ig?.followers ? fmtInt(fol.ig.followers) : "—"} />
        <Kpi label="Підписники FB" value={fol.fb?.followers ? fmtInt(fol.fb.followers) : "—"} />
        <Kpi label="Публікацій" value={fmtInt(t.posts)} current={t.posts} previous={tPrev.posts} />
        <Kpi label="Охоплення" value={fmtCompact(t.reach)} current={t.reach} previous={tPrev.reach} />
        <Kpi label="Збереження" value={fmtInt(t.saves)} current={t.saves} previous={tPrev.saves} />
        <Kpi label="Переходи в профіль" value={fmtInt(t.profileVisits)} current={t.profileVisits} previous={tPrev.profileVisits} />
      </div>

      {posts.length === 0 ? (
        <Empty>Публікацій за цей період немає.</Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
          {posts.map((p) => (
            <article key={p.id} className="card overflow-hidden flex flex-col">
              <a href={p.permalink ?? undefined} target="_blank" rel="noreferrer" className="relative block bg-panel-2">
                {p.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.thumbnailUrl} alt="" className="aspect-[4/5] w-full object-cover" loading="lazy" />
                ) : (
                  <div className="aspect-[4/5]" />
                )}
                <span className="absolute left-2 top-2 rounded-full bg-overlay px-2 py-0.5 text-[11px] text-white">
                  {p.platform === "ig" ? "IG" : "FB"} · {TYPE_LABEL[p.contentType] ?? p.contentType}
                </span>
                {(p.contentType === "reel" || p.contentType === "video") && (
                  <span className="absolute right-2 top-2 rounded-full bg-overlay p-1.5">
                    <Play size={12} fill="white" />
                  </span>
                )}
                {p.boosted && (
                  <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-ink">
                    <Zap size={11} /> бустився
                  </span>
                )}
              </a>
              <div className="flex flex-1 flex-col p-3.5">
                <div className="text-[11.5px] text-faint">{fmtDate(p.publishedAt, true)}</div>
                {p.caption && <p className="mt-1 line-clamp-2 text-[12.5px] text-muted">{p.caption}</p>}
                <div className="mt-auto grid grid-cols-3 gap-y-1.5 pt-3 text-[12px]">
                  <M icon={<Eye size={12} />} v={p.reach} title="Охоплення" />
                  <M icon={<Heart size={12} />} v={p.likes} title="Вподобання" />
                  <M icon={<MessageCircle size={12} />} v={p.comments} title="Коментарі" />
                  <M icon={<Bookmark size={12} />} v={p.saves} title="Збереження" />
                  <M icon={<Send size={12} />} v={p.shares} title="Репости" />
                  <M icon={<Play size={12} />} v={p.views} title="Перегляди" />
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      <p className="text-[12px] text-faint">Детальна статистика (охоплення, збереження, перегляди) оновлюється для постів за останні 30 днів; старіші зберігають останні відомі значення.</p>
    </div>
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
