import { requireSession } from "@/lib/auth/require-session";
import Link from "next/link";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listMediaItems, listMediaTags, listMediaTypeCounts } from "@/lib/media/service";
import { PageShell, PermissionDenied, EmptyState } from "@/components/page-shell";
import { MediaScanButton } from "./media-scan-button";
import { MediaImageUploadPanel } from "./media-image-upload-panel";
import { MediaItemCard } from "./media-item-card";
import { FilterLink, mediaHref, toggleFavoriteHref, toggleTagHref, toggleTypeHref, type MediaFilterState } from "./media-filter-links";
import { getServerLocale, t, type Locale } from "@/lib/i18n/translations";

export const dynamic = "force-dynamic";

type MediaSearchParams = { type?: string; q?: string; favorite?: string; tag?: string };

function modeTitle(locale: Locale, type: "image" | "video" | "audio" | undefined): string {
	if (type === "image") return t("mediaPage.workspace.image", locale);
	if (type === "video") return t("mediaPage.workspace.video", locale);
	if (type === "audio") return t("mediaPage.workspace.audio", locale);
	return t("mediaPage.workspace.all", locale);
}
function modeDescription(locale: Locale, type: "image" | "video" | "audio" | undefined): string {
	if (type === "image") return t("mediaPage.workspace.imageDesc", locale);
	if (type === "video") return t("mediaPage.workspace.videoDesc", locale);
	if (type === "audio") return t("mediaPage.workspace.audioDesc", locale);
	return t("mediaPage.workspace.allDesc", locale);
}
function typeLabel(locale: Locale, type: "image" | "video" | "audio"): string {
	if (type === "image") return t("mediaPage.stat.image", locale);
	if (type === "video") return t("mediaPage.stat.video", locale);
	return t("mediaPage.stat.audio", locale);
}

export default async function Page({ searchParams }: { searchParams?: Promise<MediaSearchParams> }) {
  const session = await requireSession("/media");
  if (!sessionHasPermission(session, "storage:read")) return <PermissionDenied />;
  const canManageMedia = sessionHasPermission(session, "media:manage");
  const locale = await getServerLocale();
  const params = await searchParams;
  const mediaType = params?.type === "image" || params?.type === "video" || params?.type === "audio"
    ? (params.type as "image" | "video" | "audio")
    : undefined;
  const favorite = params?.favorite === "1" ? true : undefined;
  const q = params?.q?.trim() || undefined;
  const tag = params?.tag?.trim() || undefined;
  const [media, tagCloud, typeCounts] = await Promise.all([
    listMediaItems({ mediaType, q, favorite, tag }),
    listMediaTags(),
    listMediaTypeCounts({ q, favorite, tag }),
  ]);
  const filters: MediaFilterState = { type: mediaType, q, favorite, tag };

  const grouped = new Map<string, typeof media>();
  for (const m of media) {
    const groupKey = m.storageNode?.server?.name ?? m.storageNode?.name ?? t("mediaPage.group.unassigned", locale);
    if (!grouped.has(groupKey)) grouped.set(groupKey, []);
    grouped.get(groupKey)!.push(m);
  }

  const imageCount = typeCounts.image;
  const videoCount = typeCounts.video;
  const audioCount = typeCounts.audio;
  const totalCount = imageCount + videoCount + audioCount;
  const favCount = media.filter((m) => m.favorite).length;
  const modeTitleText = modeTitle(locale, mediaType);
  const modeDescriptionText = modeDescription(locale, mediaType);

  return (
    <PageShell>
      <header className="mb-6 overflow-hidden rounded-3xl border border-white/[0.08] bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.18),transparent_36%),linear-gradient(135deg,rgba(15,23,42,0.95),rgba(2,6,23,0.88))] p-6 shadow-2xl shadow-cyan-950/20 light:bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.16),transparent_34%),linear-gradient(135deg,#ffffff,#f8fafc)] light:shadow-slate-200/60">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p data-page-eyebrow className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300">{t("mediaPage.eyebrow", locale)}</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--text-primary)]">{t("mediaPage.title", locale)}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">{t("mediaPage.desc", locale)}</p>
          </div>
          <div className="grid min-w-[260px] grid-cols-3 gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.05] p-2 text-center">
            <div className="rounded-xl bg-blue-400/10 px-3 py-2"><div className="text-lg font-semibold text-blue-100">{imageCount}</div><div className="text-[10px] text-blue-200/70">{t("mediaPage.stat.image", locale)}</div></div>
            <div className="rounded-xl bg-purple-400/10 px-3 py-2"><div className="text-lg font-semibold text-purple-100 light:text-purple-900">{videoCount}</div><div className="text-[10px] text-purple-200/70 light:text-purple-700">{t("mediaPage.stat.video", locale)}</div></div>
            <div className="rounded-xl bg-emerald-400/10 px-3 py-2"><div className="text-lg font-semibold text-emerald-100">{audioCount}</div><div className="text-[10px] text-emerald-200/70">{t("mediaPage.stat.audio", locale)}</div></div>
          </div>
        </div>
      </header>

      <section className="mb-5 grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300/70">{t("mediaPage.workspace.label", locale)}</p>
              <h2 className="mt-1 text-xl font-semibold text-white">{modeTitleText}</h2>
              <p className="mt-1 text-sm text-slate-400">{modeDescriptionText}</p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              {mediaType === "image" ? (
                <Link href="/image-bed" data-tone="emerald" className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 px-3 py-1.5 font-medium text-emerald-200 transition hover:bg-emerald-400/20">
                  {t("mediaPage.linkHub.label", locale)}
                </Link>
              ) : null}
              <span data-tone="cyan" className="inline-flex items-center rounded-full border border-cyan-400/20 px-3 py-1.5 text-cyan-200">{t("mediaPage.viewCount", locale).replace("{count}", String(media.length))}</span>
            </div>
          </div>

          <div role="tablist" aria-label={t("mediaPage.aria.mediaType", locale)} className="mt-4 grid gap-2 text-sm sm:grid-cols-4">
            <FilterLink href={mediaHref({ favorite, q, tag })} active={!mediaType} activeClassName="border-cyan-400/45 bg-cyan-400/20 text-cyan-100" inactiveClassName="border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.06]" className="rounded-2xl border px-4 py-3 transition">
              <span className="block text-base">{t("mediaPage.filter.allTab", locale)}</span><span className="text-xs opacity-70">{t("mediaPage.filter.allCount", locale).replace("{count}", String(totalCount))}</span>
            </FilterLink>
            <FilterLink href={toggleTypeHref(filters, "image")} active={mediaType === "image"} activeClassName="border-blue-400/55 bg-blue-400/20 text-blue-100" inactiveClassName="border-blue-400/20 bg-blue-400/[0.06] text-blue-200 hover:bg-blue-400/10" className="rounded-2xl border px-4 py-3 transition" title={mediaType === "image" ? t("mediaPage.filter.titleToggleOffType", locale).replace("{type}", typeLabel(locale, "image")) : t("mediaPage.filter.titleOnlyType", locale).replace("{type}", typeLabel(locale, "image"))}>
              <span className="flex items-center justify-between"><span>{t("mediaPage.filter.imageTab", locale)}</span><span>{imageCount}</span></span><span className="mt-1 block text-xs opacity-70">{t("mediaPage.filter.imageDesc", locale)} {mediaType === "image" ? t("mediaPage.filter.toggleOff", locale) : ""}</span>
            </FilterLink>
            <FilterLink href={toggleTypeHref(filters, "video")} active={mediaType === "video"} activeClassName="border-purple-400/55 bg-purple-400/20 text-purple-100 light:text-purple-900" inactiveClassName="border-purple-400/20 bg-purple-400/[0.06] text-purple-200 light:text-purple-800 hover:bg-purple-400/10" className="rounded-2xl border px-4 py-3 transition" title={mediaType === "video" ? t("mediaPage.filter.titleToggleOffType", locale).replace("{type}", typeLabel(locale, "video")) : t("mediaPage.filter.titleOnlyType", locale).replace("{type}", typeLabel(locale, "video"))}>
              <span className="flex items-center justify-between"><span>{t("mediaPage.filter.videoTab", locale)}</span><span>{videoCount}</span></span><span className="mt-1 block text-xs opacity-70">{t("mediaPage.filter.videoDesc", locale)} {mediaType === "video" ? t("mediaPage.filter.toggleOff", locale) : ""}</span>
            </FilterLink>
            <FilterLink href={toggleTypeHref(filters, "audio")} active={mediaType === "audio"} activeClassName="border-emerald-400/55 bg-emerald-400/20 text-emerald-100" inactiveClassName="border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-200 hover:bg-emerald-400/10" className="rounded-2xl border px-4 py-3 transition" title={mediaType === "audio" ? t("mediaPage.filter.titleToggleOffType", locale).replace("{type}", typeLabel(locale, "audio")) : t("mediaPage.filter.titleOnlyType", locale).replace("{type}", typeLabel(locale, "audio"))}>
              <span className="flex items-center justify-between"><span>{t("mediaPage.filter.audioTab", locale)}</span><span>{audioCount}</span></span><span className="mt-1 block text-xs opacity-70">{t("mediaPage.filter.audioDesc", locale)} {mediaType === "audio" ? t("mediaPage.filter.toggleOff", locale) : ""}</span>
            </FilterLink>
          </div>
        </div>

        <aside className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
          <h2 className="text-sm font-semibold text-white">{t("mediaPage.flow.title", locale)}</h2>
          <ol className="mt-3 space-y-3 text-sm text-slate-400">
            <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cyan-400/15 text-xs text-cyan-200">1</span><span>{t("mediaPage.flow.step1", locale)}</span></li>
            <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cyan-400/15 text-xs text-cyan-200">2</span><span>{t("mediaPage.flow.step2", locale)}</span></li>
            <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cyan-400/15 text-xs text-cyan-200">3</span><span>{t("mediaPage.flow.step3", locale)}</span></li>
          </ol>
        </aside>
      </section>

      <form method="GET" action="/media" className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3">
        {mediaType && <input type="hidden" name="type" value={mediaType} />}
        {favorite && <input type="hidden" name="favorite" value="1" />}
        {tag && <input type="hidden" name="tag" value={tag} />}
        <div className="flex w-full max-w-sm flex-col gap-1">
          <label htmlFor="media-search" className="text-xs font-medium text-slate-400">
            {t("mediaPage.search.label", locale)}
          </label>
          <input
            id="media-search"
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder={t("mediaPage.search.placeholder", locale)}
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-400/50"
          />
        </div>
        <button type="submit" className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-500">{t("mediaPage.search.submit", locale)}</button>
        {(q || tag || mediaType || favorite) && (
          <FilterLink href="/media" active={false} activeClassName="" inactiveClassName="rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-400 transition hover:bg-white/5">
            {t("mediaPage.search.clearFilters", locale)}
          </FilterLink>
        )}
      </form>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <FilterLink href={toggleFavoriteHref(filters)} active={favorite === true} activeClassName="border-amber-400/40 bg-amber-400/20 text-amber-100" inactiveClassName="border-amber-400/20 bg-amber-400/[0.06] text-amber-200 hover:bg-amber-400/10" className="rounded-full border px-3 py-1 transition" title={favorite ? t("mediaPage.filter.titleToggleOffFav", locale) : t("mediaPage.filter.titleOnlyFav", locale)}>
          {t("mediaPage.favoriteFilter", locale).replace("{count}", String(favCount))}
        </FilterLink>
      </div>

      {tagCloud.length > 0 && (
        <div data-card className="mb-5  p-3">
          <div className="mb-2 text-xs font-semibold text-slate-400">{t("mediaPage.tagFilter.title", locale)}</div>
          <div className="flex flex-wrap gap-2 text-xs">
            {tagCloud.map((entry) => (
              <FilterLink
                key={entry.tag}
                href={toggleTagHref(filters, entry.tag)}
                active={tag === entry.tag}
                activeClassName="border-cyan-400/40 bg-cyan-400/20 text-cyan-100"
                inactiveClassName="border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.06]"
                className="rounded-full border px-2.5 py-1 transition"
                title={tag === entry.tag ? t("mediaPage.tagFilter.titleToggleOff", locale).replace("{tag}", entry.tag) : t("mediaPage.tagFilter.titleApply", locale).replace("{tag}", entry.tag)}
              >
                #{entry.tag} <span className="opacity-60">{entry.count}</span>
                {tag === entry.tag ? <span className="ml-1 opacity-70">×</span> : null}
              </FilterLink>
            ))}
          </div>
        </div>
      )}

      {canManageMedia && mediaType === "image" && (
        <section data-tone="emerald" className="mb-5 rounded-2xl border border-emerald-400/20 p-4 light:border-emerald-200 light:bg-emerald-50">
          <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-emerald-100">{t("mediaPage.upload.title", locale)}</h2>
              <p className="mt-1 text-xs text-emerald-100/80">{t("mediaPage.upload.desc", locale)}</p>
            </div>
            <Link href="/image-bed" data-tone="emerald" className="inline-flex items-center justify-center rounded-xl border border-emerald-300/30 px-3 py-2 text-xs font-medium text-emerald-100 transition hover:bg-emerald-500/25">
              {t("mediaPage.linkHub.open", locale)}
            </Link>
          </div>
          <MediaImageUploadPanel />
        </section>
      )}

      {canManageMedia && <MediaScanButton />}

      {grouped.size === 0 && (
        <EmptyState icon="🎬" variant="boxed">
          {t("mediaPage.empty", locale)}
        </EmptyState>
      )}

      {Array.from(grouped.entries()).map(([serverName, items]) => (
        <section key={serverName} className="mb-6">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-lg">🖥️</span>
            <h2 className="text-sm font-semibold text-white">{serverName}</h2>
            <span className="rounded-full border border-white/[0.08] px-2 py-0.5 text-[10px] text-slate-400">{t("mediaPage.itemCount", locale).replace("{count}", String(items.length))}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((m) => (
              <MediaItemCard key={m.id} item={m as unknown as import("./media-item-card").MediaItem} canManage={canManageMedia} />
            ))}
          </div>
        </section>
      ))}
    </PageShell>
  );
}
