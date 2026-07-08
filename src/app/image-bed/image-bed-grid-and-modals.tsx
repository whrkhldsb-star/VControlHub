"use client";

import Image from "next/image";
import type { Dispatch, SetStateAction } from "react";
import { Card } from "@/components/page-shell";
import { useDialogFocus } from "@/lib/a11y/use-dialog-focus";
import type { ImageItem, PendingDelete } from "./image-bed-types";
import { formatImageSize, type ImageBedT } from "./image-bed-sections";

type PublishForm = {
  storageNodeId: string;
  relativePath: string;
  filename: string;
  album: string;
};
type StorageNodeOption = { id: string; name: string };

export function ImageGrid({
  images,
  batchMode,
  selectedIds,
  canDelete,
  formatDate,
  formatPublishSource,
  toggleSelect,
  setPreviewImage,
  copyLink,
  copyMarkdown,
  copyHTML,
  requestDelete,
  t,
}: {
  images: ImageItem[];
  batchMode: boolean;
  selectedIds: Set<string>;
  canDelete: boolean;
  formatDate: (iso: string) => string;
  formatPublishSource: (img: ImageItem) => string;
  toggleSelect: (id: string) => void;
  setPreviewImage: Dispatch<SetStateAction<ImageItem | null>>;
  copyLink: (url: string) => void;
  copyMarkdown: (img: ImageItem) => void;
  copyHTML: (img: ImageItem) => void;
  requestDelete: (img: ImageItem) => void;
  t: ImageBedT;
}) {
  return (
    <div
      data-testid="image-bed-grid"
      className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
    >
      {images.map((img) => (
        <Card key={img.id}>
          <div className="group relative mb-3 aspect-square overflow-hidden rounded-lg bg-[var(--input-bg)]">
            {batchMode && (
              <div
                role="checkbox"
                tabIndex={0}
                aria-checked={selectedIds.has(img.id)}
                aria-label={selectedIds.has(img.id) ? "Unselect" : "Select"}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleSelect(img.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleSelect(img.id);
                  }
                }}
                className={`absolute left-2 top-2 z-10 flex h-6 w-6 cursor-pointer items-center justify-center rounded-lg border-2 transition focus:outline-none focus:ring-2 focus:ring-[var(--color-action)] ${selectedIds.has(img.id) ? "border-[var(--color-action-border)] bg-[var(--color-action)] text-[var(--text-primary)]" : "border-[var(--border)] bg-black/50 hover:border-[var(--border)]"}`}
              >
                {selectedIds.has(img.id) && "✓"}
              </div>
            )}
            <div
              role="button"
              tabIndex={0}
              aria-label={img.filename}
              onKeyDown={(e) => {
                if (!batchMode && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  setPreviewImage(img);
                }
              }}
              className="h-full w-full"
            >
              <Image
                src={img.publicUrl}
                alt={img.filename}
                fill
                sizes="(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                unoptimized
                className="cursor-pointer object-cover transition-transform duration-200 hover:scale-105"
                onClick={() => !batchMode && setPreviewImage(img)}
              />
            </div>
            {!batchMode && (
              <div
                data-testid="image-card-overlay"
                className="absolute inset-0 flex items-center justify-center gap-1 bg-black/50 p-2 md:bg-black/60 md:p-0 md:opacity-0 md:group-hover:opacity-100"
              >
                <button
                  onClick={() => copyLink(img.publicUrl)}
                  className="min-h-11 min-w-11 rounded-lg bg-[var(--color-action)]/20 px-2 text-xs text-[var(--color-action)] hover:bg-[var(--color-action)]/30"
                  title={t("imageBedPage.copy.title.url")}
                  aria-label={t("imageBedPage.copy.title.url")}
                >
                  🔗
                </button>
                <button
                  onClick={() => copyMarkdown(img)}
                  className="min-h-11 min-w-11 rounded-lg bg-[var(--success-bg)] px-2 text-xs text-[var(--success)] hover:bg-[var(--success-bg)]"
                  title={t("imageBedPage.copy.title.markdown")}
                  aria-label={t("imageBedPage.copy.title.markdown")}
                >
                  M↓
                </button>
                <button
                  onClick={() => copyHTML(img)}
                  className="min-h-11 min-w-11 rounded-lg bg-[var(--warning-bg)] px-2 text-xs text-[var(--warning)] hover:bg-[var(--warning-bg)]/80"
                  title={t("imageBedPage.copy.title.html")}
                  aria-label={t("imageBedPage.copy.title.html")}
                >
                  H
                </button>
                {canDelete && (
                  <button
                    onClick={() => requestDelete(img)}
                    className="min-h-11 min-w-11 rounded-lg bg-[var(--danger-bg)] px-2 text-xs text-[var(--danger)] hover:bg-[var(--danger-bg)]"
                    title={t("imageBedPage.image.delete.aria")}
                    aria-label={t("imageBedPage.image.delete.aria")}
                  >
                    🗑
                  </button>
                )}
              </div>
            )}
          </div>
          <div
            className="truncate text-xs text-[var(--text-secondary)]"
            title={img.filename}
          >
            {img.filename}
          </div>
          <div
            className="mt-1 truncate text-[10px] text-[var(--text-muted)]"
            title={formatPublishSource(img)}
          >
            {t("imageBedPage.image.source") + formatPublishSource(img)}
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-[10px] text-[var(--text-muted)]">
              {formatImageSize(img.sizeBytes)} · {formatDate(img.createdAt)}
            </span>
            <div className="flex items-center gap-1">
              {img.album && (
                <span className="rounded-lg bg-[var(--surface-hover)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                  {img.album}
                </span>
              )}
              <span
                className={`rounded-lg px-1 py-0.5 text-[9px] ${img.isPublic ? "bg-[var(--success-bg)] text-[var(--success)]" : "bg-[var(--surface-hover)] text-[var(--text-muted)]"}`}
              >
                {img.isPublic
                  ? t("imageBedPage.image.public")
                  : t("imageBedPage.image.private")}
              </span>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

export function PublishFromStorageModal({
  publishForm,
  storageNodes,
  handlePublishFromStorage,
  setPublishForm,
  onClose,
  t,
}: {
  publishForm: PublishForm;
  storageNodes: StorageNodeOption[];
  handlePublishFromStorage: () => void;
  setPublishForm: Dispatch<SetStateAction<PublishForm>>;
  onClose: () => void;
  t: ImageBedT;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>({ open: true, onClose });
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="imageBedPublishTitle"
        className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--modal-bg)] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="imageBedPublishTitle" className="mb-4 text-lg font-semibold text-[var(--text-primary)]">
          {t("imageBedPage.publishFromStorage.title")}
        </h3>
        <div className="space-y-3">
          <div>
            <label
              className="mb-1 block text-xs text-[var(--text-secondary)]"
              htmlFor="imageBedPublishNode"
            >
              {t("imageBedPage.publishFromStorage.node")}
            </label>
            <select
              id="imageBedPublishNode"
              value={publishForm.storageNodeId}
              onChange={(e) =>
                setPublishForm({
                  ...publishForm,
                  storageNodeId: e.target.value,
                })
              }
              className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--color-action-border)]/50 focus:outline-none"
            >
              <option value="">
                {t("imageBedPage.publishFromStorage.nodePlaceholder")}
              </option>
              {storageNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              className="mb-1 block text-xs text-[var(--text-secondary)]"
              htmlFor="imageBedPublishPath"
            >
              {t("imageBedPage.publishFromStorage.path")}
            </label>
            <input
              id="imageBedPublishPath"
              type="text"
              value={publishForm.relativePath}
              onChange={(e) =>
                setPublishForm({ ...publishForm, relativePath: e.target.value })
              }
              placeholder="e.g. images/photo.png"
              className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--color-action-border)]/50 focus:outline-none"
            />
          </div>
          <div>
            <label
              className="mb-1 block text-xs text-[var(--text-secondary)]"
              htmlFor="imageBedPublishFilename"
            >
              {t("imageBedPage.publishFromStorage.filename")}
            </label>
            <input
              id="imageBedPublishFilename"
              type="text"
              value={publishForm.filename}
              onChange={(e) =>
                setPublishForm({ ...publishForm, filename: e.target.value })
              }
              placeholder={t(
                "imageBedPage.publishFromStorage.filenamePlaceholder",
              )}
              className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--color-action-border)]/50 focus:outline-none"
            />
          </div>
          <div>
            <label
              className="mb-1 block text-xs text-[var(--text-secondary)]"
              htmlFor="imageBedPublishAlbum"
            >
              {t("imageBedPage.publishFromStorage.album")}
            </label>
            <input
              id="imageBedPublishAlbum"
              type="text"
              value={publishForm.album}
              onChange={(e) =>
                setPublishForm({ ...publishForm, album: e.target.value })
              }
              placeholder={t(
                "imageBedPage.publishFromStorage.albumPlaceholder",
              )}
              className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--color-action-border)]/50 focus:outline-none"
            />
          </div>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:text-[var(--text-primary)] light:hover:text-[var(--text-disabled)]"
          >
            {t("imageBedPage.publishFromStorage.cancel")}
          </button>
          <button
            onClick={handlePublishFromStorage}
            disabled={!publishForm.storageNodeId || !publishForm.relativePath}
            className="rounded-lg bg-[var(--color-action-strong)] px-4 py-2 text-sm text-[var(--text-primary)] transition hover:bg-[var(--color-action)] disabled:opacity-30"
          >
            {t("imageBedPage.publishFromStorage.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DeleteImageDialog({
  pendingDelete,
  deleting,
  confirmDelete,
  onClose,
  t,
}: {
  pendingDelete: PendingDelete;
  deleting: boolean;
  confirmDelete: () => void;
  onClose: () => void;
  t: ImageBedT;
}) {
  
  const dialogRef = useDialogFocus<HTMLDivElement>({ open: true, onClose });

return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={
          pendingDelete.type === "single"
            ? t("imageBedPage.delete.ariaLabel.single")
            : t("imageBedPage.delete.ariaLabel.batch")
        }
        className="w-full max-w-md rounded-xl border border-[var(--danger-border)] bg-[var(--modal-bg)] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-2 text-lg font-semibold text-[var(--text-primary)]">
          {pendingDelete.type === "single"
            ? t("imageBedPage.delete.title.single")
            : t("imageBedPage.delete.title.batch")}
        </h3>
        <p className="text-sm leading-6 text-[var(--text-secondary)]">
          {pendingDelete.type === "single"
            ? t("imageBedPage.delete.desc.singleWithName").replace(
                "{filename}",
                pendingDelete.filename,
              )
            : t("imageBedPage.delete.desc.batchWithCount").replace(
                "{count}",
                String(pendingDelete.count),
              )}
        </p>
        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:text-[var(--text-primary)] light:hover:text-[var(--text-disabled)]"
          >
            {t("imageBedPage.delete.cancel")}
          </button>
          <button
            type="button"
            onClick={confirmDelete}
            disabled={deleting}
            className="rounded-lg bg-[var(--danger)] px-4 py-2 text-sm text-[var(--text-primary)] transition hover:bg-[var(--danger-bg)] hover:text-[var(--danger)] disabled:opacity-50"
          >
            {deleting
              ? t("imageBedPage.delete.deleting")
              : t("common.confirmDelete")}
          </button>
        </div>
      </div>
    </div>
  );
}