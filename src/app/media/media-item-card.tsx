"use client";

import { useEffect, useState } from "react";
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
import { Badge, Chip, Notice } from "@/components/ui-primitives";

import { ActionButton } from "@/components/action-button";
import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";
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

  // Keep local optimistic state aligned when list refresh replaces `item` props.
  useEffect(() => {
    setFav(item.favorite);
    setTags(item.tags || []);
  }, [item.id, item.favorite, item.tags]);

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
    <div data-card="" className="group overflow-hidden p-3 transition hover:-translate-y-0.5 hover:border-[var(--color-action-border)]/25 light:hover:border-[var(--color-action-border)] light:hover:shadow-md">
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
            className="mt-1 truncate text-xs text-[var(--text-muted)]"
            title={item.relativePath}
          >
            📂 {item.relativePath}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-[var(--text-muted)]">
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
            data-action-button=""
            data-variant="outline"
            data-size="xs"
          >
            <Eye aria-hidden /> {t("mediaItemCard.previewButton")}
          </a>
        ) : null}
        {downloadHref ? (
          <a
            href={downloadHref}
            data-action-button=""
            data-variant="secondary"
            data-size="xs"
          >
            <Download aria-hidden /> {t("mediaItemCard.downloadButton")}
          </a>
        ) : null}
        {sourceHref ? (
          <a
            href={sourceHref}
            data-action-button=""
            data-variant="secondary"
            data-size="xs"
          >
            <FolderOpen aria-hidden /> {t("mediaItemCard.sourceFileButton")}
          </a>
        ) : null}
        {canManage && item.mediaType ==="image" && item.storageNode ? (
          <ActionButton
            size="xs"
            variant="success"
            icon={<LinkIcon aria-hidden />}
            onClick={() => void publishAsImageBed()}
            loading={publishing}
            title={t("mediaItemCard.publishTooltip")}
          >
            {publishing
              ? t("mediaItemCard.publishing")
              : t("mediaItemCard.publishToImageBed")}
          </ActionButton>
        ) : null}
      </div>
      {imageBedUrl ? (
        <Notice tone="success" compact className="mt-2">
          {t("mediaItemCard.imageBedUrlGenerated")}:
          <a
            href={imageBedUrl}
            target="_blank"
            rel="noreferrer"
            className="break-all underline"
          >
            {imageBedUrl}
          </a>
        </Notice>
      ) : null}
      {publishError ? (
        <p role="alert" className="mt-2 text-xs text-[var(--danger)]">
          {publishError}
        </p>
      ) : null}
      {mutationError ? (
        <p role="alert" className="mt-2 text-xs text-[var(--danger)]">
          {mutationError}
        </p>
      ) : null}
      {canManage && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {tags.map((tag) => (
            <Badge tone="accent" className="inline-flex items-center gap-1" key={tag}
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
            </Badge>
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
              className={cn(UI_INPUT, "min-h-[var(--control-height-sm)] w-24 rounded-full px-2.5 py-0.5 text-xs")}
              placeholder={t("mediaItemCard.newTagPlaceholder")}
            />
          ) : (
            <Chip
              dashed
              icon={<Tag aria-hidden />}
              onClick={() => setShowTagInput(true)}
              className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
            >
              {t("mediaItemCard.addTag")}
            </Chip>
          )}
        </div>
      )}
      {!canManage && tags.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {tags.map((tag) => (
            <Link
              key={tag}
              href={`/media?tag=${encodeURIComponent(tag)}`}
              data-chip=""
            >
              #{tag}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
