import { sessionHasPermission } from "@/lib/auth/authorization";
import { requirePagePermission } from "@/lib/auth/page-guard";
import {
  countMediaItems,
  listMediaItems,
  listMediaTags,
  listMediaTypeCounts,
  MEDIA_PAGE_SIZE,
} from "@/lib/media/service";
import { LinkPagination } from "@/components/link-pagination";
import {
  PageShell,
  PageHeader,
  EmptyState,
} from "@/components/page-shell";
import { ImageIcon, Search as SearchIcon, Server, Star } from "@/components/icons";
import { UI_INPUT } from "@/lib/ui/classes";
import { MediaScanButton } from "./media-scan-button";
import { MediaImageUploadPanel } from "./media-image-upload-panel";
import { MediaItemCard } from "./media-item-card";
import {
  FilterLink,
  mediaHref,
  toggleFavoriteHref,
  toggleTagHref,
  toggleTypeHref,
  type MediaFilterState,
} from "./media-filter-links";
import { getServerLocale, t, type Locale } from "@/lib/i18n/translations";
import { ActionButton } from "@/components/action-button";
import { Badge } from "@/components/ui-primitives";
import { ButtonLink } from "@/components/action-button";
export const dynamic ="force-dynamic";
type MediaSearchParams = {
  type?: string;
  q?: string;
  favorite?: string;
  tag?: string;
  page?: string;
};
function modeTitle(
  locale: Locale,
  type:"image" |"video" |"audio" | undefined,
): string {
  if (type ==="image") return t("mediaPage.workspace.image", locale);
  if (type ==="video") return t("mediaPage.workspace.video", locale);
  if (type ==="audio") return t("mediaPage.workspace.audio", locale);
  return t("mediaPage.workspace.all", locale);
}
function modeDescription(
  locale: Locale,
  type:"image" |"video" |"audio" | undefined,
): string {
  if (type ==="image") return t("mediaPage.workspace.imageDesc", locale);
  if (type ==="video") return t("mediaPage.workspace.videoDesc", locale);
  if (type ==="audio") return t("mediaPage.workspace.audioDesc", locale);
  return t("mediaPage.workspace.allDesc", locale);
}
function typeLabel(locale: Locale, type:"image" |"video" |"audio"): string {
  if (type ==="image") return t("mediaPage.stat.image", locale);
  if (type ==="video") return t("mediaPage.stat.video", locale);
  return t("mediaPage.stat.audio", locale);
}
export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<MediaSearchParams>;
}) {
  const session = await requirePagePermission("storage:read", { redirectTo: "/media" });
  const canManageMedia = sessionHasPermission(session,"media:manage");
  const locale = await getServerLocale();
  const params = await searchParams;
  const mediaType =
    params?.type ==="image" ||
    params?.type ==="video" ||
    params?.type ==="audio"
      ? (params.type as"image" |"video" |"audio")
      : undefined;
  const favorite = params?.favorite ==="1" ? true : undefined;
  const q = params?.q?.trim() || undefined;
  const tag = params?.tag?.trim() || undefined;
  const requestedPage = /^\d+$/.test(params?.page ?? "") ? Number(params?.page) : 1;
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  // The list is one page; the totals come from the database for the same
  // filters, so counts and what can be browsed always agree.
  const [media, tagCloud, typeCounts, matchingCount, favCount] = await Promise.all([
    listMediaItems({ mediaType, q, favorite, tag, session, page, pageSize: MEDIA_PAGE_SIZE }),
    listMediaTags(session),
    listMediaTypeCounts({ q, favorite, tag , session}),
    countMediaItems({ mediaType, q, favorite, tag, session }),
    countMediaItems({ mediaType, q, tag, favorite: true, session }),
  ]);
  const filters: MediaFilterState = { type: mediaType, q, favorite, tag };
  const grouped = new Map<string, typeof media>();
  for (const m of media) {
    const groupKey =
      m.storageNode?.server?.name ??
      m.storageNode?.name ??
      t("mediaPage.group.unassigned", locale);
    if (!grouped.has(groupKey)) grouped.set(groupKey, []);
    grouped.get(groupKey)!.push(m);
  }
  const imageCount = typeCounts.image;
  const videoCount = typeCounts.video;
  const audioCount = typeCounts.audio;
  const totalCount = imageCount + videoCount + audioCount;
  const modeTitleText = modeTitle(locale, mediaType);
  const modeDescriptionText = modeDescription(locale, mediaType);
  return (
    <PageShell>
      <PageHeader eyebrow={t("mediaPage.eyebrow", locale)} title={t("mediaPage.title", locale)} description={t("mediaPage.description", locale)}>
        {canManageMedia ? <MediaScanButton /> : null}
      </PageHeader>
      {/* One card for "what am I looking at": the mode, its count and the type filters (which carry the totals). */}
      <section data-card className="mb-5 min-w-0 p-4 sm:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <p className="ui-eyebrow">{t("mediaPage.workspace.label", locale)}</p>
            <h2 className="ui-title-section mt-0.5">{modeTitleText}</h2>
            <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">{modeDescriptionText}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {mediaType ==="image" ? (
              <ButtonLink href="/image-bed" size="sm" variant="secondary">
                {t("mediaPage.linkHub.label", locale)}
              </ButtonLink>
            ) : null}
            <Badge tone="accent">{t("mediaPage.viewCount", locale, { count: matchingCount })}</Badge>
          </div>
        </div>
        <div
          role="navigation"
          aria-label={t("mediaPage.aria.mediaType", locale)}
          className="mt-4 grid grid-cols-2 gap-2 text-sm lg:grid-cols-4"
        >
          <FilterLink
            href={mediaHref({ favorite, q, tag })}
            active={!mediaType}
            activeClassName="border-[var(--color-action-border)] bg-[var(--color-action-bg)] text-[var(--text-primary)]"
            inactiveClassName="border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
            className="rounded-[calc(var(--radius-card)-2px)] border px-4 py-3 transition"
          >
            <span className="block font-medium">{t("mediaPage.filter.allTab", locale)}</span>
            <span className="mt-1 block text-xs text-[var(--text-muted)]">
              {t("mediaPage.filter.allCount", locale, { count: totalCount })}
            </span>
          </FilterLink>
          <FilterLink
            href={toggleTypeHref(filters,"image")}
            active={mediaType ==="image"}
            activeClassName="border-[var(--color-action-border)] bg-[var(--color-action-bg)] text-[var(--text-primary)]"
            inactiveClassName="border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
            className="rounded-[calc(var(--radius-card)-2px)] border px-4 py-3 transition"
            title={
              mediaType ==="image"
                ? t("mediaPage.filter.titleToggleOffType", locale, { type: typeLabel(locale,"image") })
                : t("mediaPage.filter.titleOnlyType", locale, { type: typeLabel(locale,"image") })
            }
          >
            <span className="flex items-center justify-between gap-2">
              <span className="font-medium">{t("mediaPage.filter.imageTab", locale)}</span>
              <span className="tabular-nums text-[var(--text-muted)]">{imageCount}</span>
            </span>
            <span className="mt-1 block text-xs text-[var(--text-muted)]">
              {t("mediaPage.filter.imageDesc", locale)}
              {mediaType ==="image"
                ? t("mediaPage.filter.toggleOff", locale)
                :""}
            </span>
          </FilterLink>
          <FilterLink
            href={toggleTypeHref(filters,"video")}
            active={mediaType ==="video"}
            activeClassName="border-[var(--color-action-border)] bg-[var(--color-action-bg)] text-[var(--text-primary)]"
            inactiveClassName="border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
            className="rounded-[calc(var(--radius-card)-2px)] border px-4 py-3 transition"
            title={
              mediaType ==="video"
                ? t("mediaPage.filter.titleToggleOffType", locale, { type: typeLabel(locale,"video") })
                : t("mediaPage.filter.titleOnlyType", locale, { type: typeLabel(locale,"video") })
            }
          >
            <span className="flex items-center justify-between gap-2">
              <span className="font-medium">{t("mediaPage.filter.videoTab", locale)}</span>
              <span className="tabular-nums text-[var(--text-muted)]">{videoCount}</span>
            </span>
            <span className="mt-1 block text-xs text-[var(--text-muted)]">
              {t("mediaPage.filter.videoDesc", locale)}
              {mediaType ==="video"
                ? t("mediaPage.filter.toggleOff", locale)
                :""}
            </span>
          </FilterLink>
          <FilterLink
            href={toggleTypeHref(filters,"audio")}
            active={mediaType ==="audio"}
            activeClassName="border-[var(--color-action-border)] bg-[var(--color-action-bg)] text-[var(--text-primary)]"
            inactiveClassName="border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
            className="rounded-[calc(var(--radius-card)-2px)] border px-4 py-3 transition"
            title={
              mediaType ==="audio"
                ? t("mediaPage.filter.titleToggleOffType", locale, { type: typeLabel(locale,"audio") })
                : t("mediaPage.filter.titleOnlyType", locale, { type: typeLabel(locale,"audio") })
            }
          >
            <span className="flex items-center justify-between gap-2">
              <span className="font-medium">{t("mediaPage.filter.audioTab", locale)}</span>
              <span className="tabular-nums text-[var(--text-muted)]">{audioCount}</span>
            </span>
            <span className="mt-1 block text-xs text-[var(--text-muted)]">
              {t("mediaPage.filter.audioDesc", locale)}
              {mediaType ==="audio"
                ? t("mediaPage.filter.toggleOff", locale)
                :""}
            </span>
          </FilterLink>
        </div>
      </section>
      <form
        method="GET"
        action="/media"
        data-toolbar
        className="mb-4 flex flex-wrap items-center gap-2"
      >
        {mediaType && (
          <input type="hidden" name="type" value={mediaType} />
        )}
        {favorite && <input type="hidden" name="favorite" value="1" />}
        {tag && <input type="hidden" name="tag" value={tag} />}
        <label htmlFor="media-search" className="sr-only">
          {t("mediaPage.search.label", locale)}
        </label>
        <input
          id="media-search"
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder={t("mediaPage.search.placeholder", locale)}
          className={`${UI_INPUT} w-full sm:w-80`}
        />
        <ActionButton variant="secondary" type="submit" icon={<SearchIcon aria-hidden />}>
          {t("mediaPage.search.submit", locale)}
        </ActionButton>
        <FilterLink
          href={toggleFavoriteHref(filters)}
          active={favorite === true}
          activeClassName="border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)]"
          inactiveClassName="border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
          className="inline-flex min-h-[var(--control-height)] items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium transition"
          title={
            favorite
              ? t("mediaPage.filter.titleToggleOffFav", locale)
              : t("mediaPage.filter.titleOnlyFav", locale)
          }
        >
          <Star size={14} aria-hidden fill={favorite ? "currentColor" : "none"} />
          {t("mediaPage.favoriteFilter", locale, { count: favCount })}
        </FilterLink>
        {(q || tag || mediaType || favorite) && (
          <FilterLink
            href="/media"
            active={false}
            activeClassName=""
            inactiveClassName="inline-flex min-h-[var(--control-height)] items-center rounded-[var(--radius-control)] px-3 text-sm text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
          >
            {t("mediaPage.search.clearFilters", locale)}
          </FilterLink>
        )}
      </form>
      {tagCloud.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-2 text-xs">
          <span className="ui-eyebrow mr-1">{t("mediaPage.tagFilter.title", locale)}</span>
          {tagCloud.map((entry) => (
            <FilterLink
              key={entry.tag}
              href={toggleTagHref(filters, entry.tag)}
              active={tag === entry.tag}
              activeClassName="border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent)]"
              inactiveClassName="border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]"
              className="rounded-full border px-2.5 py-1 transition"
              title={
                tag === entry.tag
                  ? t("mediaPage.tagFilter.titleToggleOff", locale, { tag: entry.tag })
                  : t("mediaPage.tagFilter.titleApply", locale, { tag: entry.tag })
              }
            >
              #{entry.tag} <span className="opacity-60">{entry.count}</span>
              {tag === entry.tag ? (
                <span className="ml-1 opacity-70">×</span>
              ) : null}
            </FilterLink>
          ))}
        </div>
      )}
      {canManageMedia && mediaType ==="image" && (
        <section data-card className="mb-5 p-5">
          <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="ui-title-section">
                {t("mediaPage.upload.title", locale)}
              </h2>
              <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">
                {t("mediaPage.upload.desc", locale)}
              </p>
            </div>
            <ButtonLink href="/image-bed" size="sm" variant="secondary">
              {t("mediaPage.linkHub.open", locale)}
            </ButtonLink>
          </div>
          <MediaImageUploadPanel />
        </section>
      )}
      {grouped.size === 0 && (
        <EmptyState icon={<ImageIcon size={20} />} variant="boxed">
          {t("mediaPage.empty", locale)}
        </EmptyState>
      )}
      {Array.from(grouped.entries()).map(([serverName, items]) => (
        <section key={serverName} className="mb-6">

          <div className="mb-3 flex items-center gap-2">
            <Server size={16} className="text-[var(--text-muted)]" aria-hidden />
            <h2 className="ui-title-section">
              {serverName}
            </h2>
            <Badge>
              {t("mediaPage.itemCount", locale, { count: items.length })}
            </Badge>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">

            {items.map((m) => (
              <MediaItemCard
                key={m.id}
                item={m as unknown as import("./media-item-card").MediaItem}
                canManage={canManageMedia}
                listHref={mediaHref({ ...filters, page })}
              />
            ))}
          </div>
        </section>
      ))}
      <LinkPagination
        page={page}
        pageSize={MEDIA_PAGE_SIZE}
        total={matchingCount}
        hrefFor={(target) => mediaHref({ ...filters, page: target })}
        labels={{
          label: t("common.pagination.label", locale),
          range: t("common.pagination.range", locale, {
            start: matchingCount ? (page - 1) * MEDIA_PAGE_SIZE + 1 : 0,
            end: Math.min(page * MEDIA_PAGE_SIZE, matchingCount),
            total: matchingCount,
          }),
          previous: t("common.pagination.previous", locale),
          next: t("common.pagination.next", locale),
        }}
      />
    </PageShell>
  );
}
