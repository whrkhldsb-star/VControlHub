"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Download,
  Eye,
  FolderOpen,
  LinkIcon,
  Star,
  Tag,
} from "@/components/icons";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";

import {
  buildMediaLinks,
  getErrorMessage,
  storageLabel,
  type MediaItem,
} from "./media-item-helpers";
import { MediaCover } from "./media-item-cover";

export type { MediaItem } from "./media-item-helpers";

export function MediaItemCard({
  item,
  canManage,
}: {
  item: MediaItem;
  canManage: boolean;
}) {
  const { t } = useI18n();
  const [fav, setFav] = useState(item.favorite);
  const [tags, setTags] = useState(item.tags || []);
  const [showTagInput, setShowTagInput] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [imageBedUrl, setImageBedUrl] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  const toggleFav = async () => {
    const next = !fav;
    setFav(next);
    setMutationError(null);
    try {
      await csrfFetch(`/api/media/${item.id}`, {
        method:"PATCH",
        headers: {"Content-Type":"application/json" },
        body: JSON.stringify({ favorite: next }),
      });
    } catch (error) {
      setFav(!next);
      setMutationError(getErrorMessage(error, t("mediaItemCard.updateErrorFallback")));
    }
  };

  const addTag = async () => {
    const tag = newTag.trim();
    if (!tag || tags.includes(tag)) return;
    const previous = tags;
    const next = [...tags, tag];
    setTags(next);
    setNewTag("");
    setShowTagInput(false);
    setMutationError(null);
    try {
      await csrfFetch(`/api/media/${item.id}`, {
        method:"PATCH",
        headers: {"Content-Type":"application/json" },
        body: JSON.stringify({ tags: next }),
      });
    } catch (error) {
      setTags(previous);
      setMutationError(getErrorMessage(error, t("mediaItemCard.updateErrorFallback")));
    }
  };

  const removeTag = async (tag: string) => {
    const previous = tags;
    const next = tags.filter((x) => x !== tag);
    setTags(next);
    setMutationError(null);
    try {
      await csrfFetch(`/api/media/${item.id}`, {
        method:"PATCH",
        headers: {"Content-Type":"application/json" },
        body: JSON.stringify({ tags: next }),
      });
    } catch (error) {
      setTags(previous);
      setMutationError(getErrorMessage(error, t("mediaItemCard.updateErrorFallback")));
    }
  };

  const publishAsImageBed = async () => {
    if (!item.storageNode || item.mediaType !=="image") return;
    setPublishing(true);
    setPublishError(null);
    try {
      const result = await csrfFetch<{ publicUrl?: string }>("/api/images/publish-from-storage",
        {
          method:"POST",
          headers: {"Content-Type":"application/json" },
          body: JSON.stringify({
            storageNodeId: item.storageNode.id,
            relativePath: item.relativePath,
            filename: item.name,
          }),
        },
      );
      const publicUrl = result.publicUrl ?? "";
      const absoluteUrl = publicUrl.startsWith("http")
        ? publicUrl
        : `${window.location.origin}${publicUrl}`;
      setImageBedUrl(absoluteUrl);
      await navigator.clipboard?.writeText(absoluteUrl).catch(() => undefined);
    } catch (error) {
      setPublishError(getErrorMessage(error, t("mediaItemCard.publishErrorFallback")));
    } finally {
      setPublishing(false);
    }
  };

  const { previewHref, downloadHref, sourceHref } = buildMediaLinks(item, t);

  return (
    <div className="group overflow-hidden rounded-2xl border border-[var(--border)]/[0.07] bg-[var(--surface-elevated)] p-3 transition hover:-translate-y-0.5 hover:border-[var(--color-action-border)]/25 hover:bg-[var(--surface-hover)] light:shadow-sm light:hover:border-[var(--color-action-border)] light:hover:shadow-md">
      <MediaCover item={item} sourceHref={previewHref} t={t} />
      <div className="mt-3 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span>
              {item.mediaType ==="image"
                ?"🖼"
                : item.mediaType ==="audio"
                  ?"🎵"
                  :"🎬"}
            </span>
            <span
              className="truncate text-sm font-medium text-[var(--text-primary)]"
              title={item.name}
            >
              {item.name}
            </span>
          </div>
          <p
            className="mt-1 truncate text-[11px] text-[var(--text-muted)]"
            title={item.relativePath}
          >
            📂 {item.relativePath}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[10px] text-[var(--text-muted)]">
            <span>💾 {storageLabel(item, t)}</span>
          </div>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => void toggleFav()}
            aria-label={
              fav
                ? t("mediaItemCard.favoriteRemove")
                : t("mediaItemCard.favoriteAdd")
            }
            className={`shrink-0 rounded p-1 transition min-h-11 min-w-11 ${fav ?"text-[var(--warning)] hover:text-[var(--warning)]" :"text-[var(--text-muted)] hover:text-[var(--warning)] opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"}`}
            title={
              fav
                ? t("mediaItemCard.favoriteRemove")
                : t("mediaItemCard.favoriteAdd")
            }
          >
            <Star size={16} fill={fav ?"currentColor" :"none"} />
          </button>
        )}
        {!canManage && fav && (
          <span className="text-[var(--warning)] text-sm">⭐</span>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        {previewHref ? (
          <a
            href={previewHref}
            data-tone="cyan"
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-action-border)]/25 px-2.5 py-1.5 text-[var(--text-secondary)] hover:bg-[var(--color-action-bg)]/20"
          >
            <Eye size={13} /> {t("mediaItemCard.previewButton")}
          </a>
        ) : null}
        {downloadHref ? (
          <a
            href={downloadHref}
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)]/10 px-2.5 py-1.5 text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)] light:hover:bg-[var(--surface)]"
          >
            <Download size={13} /> {t("mediaItemCard.downloadButton")}
          </a>
        ) : null}
        {sourceHref ? (
          <a
            href={sourceHref}
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)]/10 px-2.5 py-1.5 text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)] light:hover:bg-[var(--surface)]"
          >
            <FolderOpen size={13} /> {t("mediaItemCard.sourceFileButton")}
          </a>
        ) : null}
        {canManage && item.mediaType ==="image" && item.storageNode ? (
          <button
            type="button"
            onClick={() => void publishAsImageBed()}
            disabled={publishing}
            data-tone="emerald"
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--success-border)] px-2.5 py-1.5 text-[var(--success)] hover:bg-[var(--success-bg)] hover:text-[var(--success)] disabled:opacity-50"
            title={t("mediaItemCard.publishTooltip")}
          >
            <LinkIcon size={13} />
            {publishing
              ? t("mediaItemCard.publishing")
              : t("mediaItemCard.publishToImageBed")}
          </button>
        ) : null}
      </div>
      {imageBedUrl ? (
        <div
          data-tone="emerald"
          className="mt-2 rounded-lg border border-[var(--success-border)] px-2 py-1.5 text-[11px] text-[var(--success)]"
        >
          {t("mediaItemCard.imageBedUrlGenerated")}:
          <a
            href={imageBedUrl}
            target="_blank"
            rel="noreferrer"
            className="break-all underline"
          >
            {imageBedUrl}
          </a>
        </div>
      ) : null}
      {publishError ? (
        <p role="alert" className="mt-2 text-[11px] text-[var(--danger)]">
          {publishError}
        </p>
      ) : null}
      {mutationError ? (
        <p role="alert" className="mt-2 text-[11px] text-[var(--danger)]">
          {mutationError}
        </p>
      ) : null}
      {canManage && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {tags.map((tag) => (
            <span
              key={tag}
              data-tone="cyan"
              className="inline-flex items-center gap-1 rounded-lg border border-[var(--accent-border)] px-2 py-0.5 text-[10px] text-[var(--accent)]"
            >
              <Link
                href={`/media?tag=${encodeURIComponent(tag)}`}
                className="hover:underline"
              >
                #{tag}
              </Link>
              <button
                type="button"
                onClick={() => void removeTag(tag)}
                aria-label={t("common.delete")}
                className="text-[var(--text-muted)] hover:text-[var(--accent)]"
              >
                ×
              </button>
            </span>
          ))}
          {showTagInput ? (
            <input
              autoFocus
              value={newTag}
              aria-label={t("mediaItemCard.newTagAriaLabel")}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key ==="Enter") void addTag();
                if (e.key ==="Escape") setShowTagInput(false);
              }}
              onBlur={() => {
                if (newTag.trim()) void addTag();
                else setShowTagInput(false);
              }}
              className="w-20 rounded-full bg-[var(--surface-elevated)] px-2 py-0.5 text-[10px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
              placeholder={t("mediaItemCard.newTagPlaceholder")}
            />
          ) : (
            <button
              type="button"
              onClick={() => setShowTagInput(true)}
              aria-label={t("mediaItemCard.addTag")}
              className="inline-flex items-center gap-0.5 rounded-lg border border-dashed border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--text-muted)] opacity-0 transition group-hover:opacity-100 hover:border-[var(--color-action-border)]/30 hover:text-[var(--color-action)]"
            >
              <Tag size={10} /> {t("mediaItemCard.addTag")}
            </button>
          )}
        </div>
      )}
      {!canManage && tags.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {tags.map((tag) => (
            <Link
              key={tag}
              href={`/media?tag=${encodeURIComponent(tag)}`}
              data-tone="cyan"
              className="rounded-lg border border-[var(--accent-border)] px-2 py-0.5 text-[10px] text-[var(--accent)] hover:underline"
            >
              #{tag}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
