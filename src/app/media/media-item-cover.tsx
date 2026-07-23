"use client";

import Image from "next/image";
import { ImageIcon, Music2, Video } from "@/components/icons";

import {
  formatSize,
  mediaTypeLabel,
  type MediaItem,
  type MediaTFn,
} from "./media-item-helpers";

export function MediaCover({
  item,
  sourceHref,
  t,
}: {
  item: MediaItem;
  sourceHref: string | null;
  t: MediaTFn;
}) {
  const fileHref = `/api/media/${encodeURIComponent(item.id)}/stream`;
  const thumbHref = `/api/media/${encodeURIComponent(item.id)}/thumbnail`;
  const coverClass ="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105";
  const typeBadge = (
    <span className="absolute left-2 top-2 z-10 rounded-lg border border-black/10 bg-[color-mix(in_srgb,var(--surface)_40%,#000)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-primary)] backdrop-blur light:border-[var(--border)]/30">
      {mediaTypeLabel(item.mediaType, t)}
    </span>
  );
  const icon =
    item.mediaType ==="audio" ? (
      <Music2 size={32} />
    ) : item.mediaType ==="video" ? (
      <Video size={32} />
    ) : (
      <ImageIcon size={32} />
    );
  const fallback = (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.24),transparent_45%),linear-gradient(135deg,color-mix(in srgb, var(--surface) 92%, transparent),rgba(30,41,59,0.88))] text-[var(--text-primary)]">
      <div className="rounded-2xl border border-[var(--border)]/10 bg-[var(--surface-subtle)] p-3 shadow-inner">
        {icon}
      </div>
      <span className="text-xs font-medium">
        {mediaTypeLabel(item.mediaType, t)}
        {t("mediaItemCard.typePreview")}
      </span>
    </div>
  );
  const visual =
    item.mediaType ==="image" && fileHref ? (
      <Image
        src={thumbHref}
        alt={t("mediaItemCard.thumbnailAlt").replace("{name}", item.name)}
        fill
        sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
        unoptimized
        className={coverClass}
      />
    ) : item.mediaType ==="video" ? (
      // Avoid N concurrent /stream opens for video covers; thumbnail API is image-only.
      fallback
    ) : (
      fallback
    );
  const previewHref = sourceHref ?? fileHref;
  const content = (
    <>
      {visual} {typeBadge}
      {item.mediaType !=="audio" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 to-transparent" />
      )}
      <div className="absolute bottom-2 right-2 rounded-lg border border-[var(--border)]/10 bg-[color-mix(in_srgb,var(--surface)_40%,#000)] px-2 py-0.5 text-[10px] text-[var(--text-primary)] backdrop-blur">
        {formatSize(item.size, t)}
      </div>
    </>
  );
  const ariaLabel = t("mediaItemCard.previewAriaLabel")
    .replace("{name}", item.name)
    .replace("{type}", mediaTypeLabel(item.mediaType, t));
  const className ="relative block aspect-[4/3] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)]";

  if (!previewHref) {
    return (
      <button type="button" disabled className={className} aria-label={ariaLabel}>
        {content}
      </button>
    );
  }

  return (
    <a href={previewHref} className={className} aria-label={ariaLabel}>
      {content}
    </a>
  );
}
