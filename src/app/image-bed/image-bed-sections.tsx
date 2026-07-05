"use client";

import Image from "next/image";
import type { Dispatch, SetStateAction } from "react";
import { Card } from "@/components/page-shell";
import type {
  ImageItem,
  ImageStats,
  PendingDelete,
  UploadProgress,
} from "./image-bed-types";

export type ImageBedT = (key: string) => string;

type PublishForm = {
  storageNodeId: string;
  relativePath: string;
  filename: string;
  album: string;
};
type StorageNodeOption = { id: string; name: string };

export function formatImageSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ImageBedStatsPanel({
  stats,
  onClose,
  t,
}: {
  stats: ImageStats;
  onClose: () => void;
  t: ImageBedT;
}) {
  const maxCount = Math.max(...stats.uploadTrend.map((x) => x.count), 1);
  return (
    <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          {t("imageBedPage.stats.title")}
        </h3>
        <button
          onClick={onClose}
          aria-label={t("common.close")}
          className="text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
        >
          ✕
        </button>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          [t("imageBedPage.stats.totalCount"), stats.totalCount],
          [t("imageBedPage.stats.totalSize"), `${stats.totalSizeMB} MB`],
          [t("imageBedPage.stats.albumCount"), stats.albums.length],
          [
            t("imageBedPage.stats.recent7d"),
            stats.uploadTrend.reduce((s, item) => s + item.count, 0),
          ],
        ].map(([label, value]) => (
          <div
            key={String(label)}
            className="rounded-lg bg-[var(--surface-subtle)] p-3"
          >
            <div className="text-xs text-[var(--text-muted)]">{label}</div>
            <div className="text-xl font-bold text-[var(--text-primary)]">
              {value}
            </div>
          </div>
        ))}
      </div>
      {stats.uploadTrend.length > 0 && (
        <div className="mb-3">
          <div className="mb-1 text-xs text-[var(--text-secondary)]">
            {t("imageBedPage.stats.trend7d")}
          </div>
          <div className="flex h-16 items-end gap-1">
            {stats.uploadTrend.map((trend) => (
              <div
                key={trend.date}
                className="flex flex-1 flex-col items-center gap-0.5"
                title={t("imageBedPage.stats.imageCountTitle")
                  .replace("{date}", trend.date)
                  .replace("{count}", String(trend.count))}
              >
                <div className="text-[9px] text-[var(--text-muted)]">
                  {trend.count}
                </div>
                <div
                  className="w-full rounded-t bg-[var(--color-action)]/60"
                  style={{
                    height: `${Math.max((trend.count / maxCount) * 100, 8)}%`,
                  }}
                />
                <div className="text-[8px] text-[var(--text-muted)]">
                  {trend.date.slice(5)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {stats.albums.length > 0 && (
        <div>
          <div className="mb-1 text-xs text-[var(--text-secondary)]">
            {t("imageBedPage.stats.albumDist")}
          </div>
          <div className="space-y-1">
            {stats.albums.slice(0, 5).map((a) => (
              <div
                key={a.album}
                className="flex items-center justify-between text-xs"
              >
                <span className="text-[var(--text-secondary)]">{a.album}</span>
                <span className="text-[var(--text-muted)]">
                  {t("imageBedPage.stats.albumCountSize")
                    .replace("{count}", String(a.count))
                    .replace("{size}", formatImageSize(a.sizeBytes))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function UploadProgressPanel({
  uploadProgress,
  uploading,
  t,
}: {
  uploadProgress: UploadProgress;
  uploading: boolean;
  t: ImageBedT;
}) {
  if (!uploadProgress) return null;
  const done = uploadProgress.success + uploadProgress.failure;
  return (
    <div
      role="status"
      aria-label={t("imageBedPage.progress.region")}
      className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4 text-sm text-[var(--text-secondary)]"
    >
      <div className="flex items-center justify-between gap-3">
        <span>
          {uploading
            ? t("imageBedPage.progress.current")
                .replace("{current}", String(uploadProgress.current))
                .replace("{total}", String(uploadProgress.total))
            : t("imageBedPage.progress.completed")
                .replace("{success}", String(uploadProgress.success))
                .replace("{total}", String(uploadProgress.total))}
        </span>
        <span className="text-xs text-[var(--text-muted)]">
          {t("imageBedPage.progress.success")
            .replace("{success}", String(uploadProgress.success))
            .replace("{failure}", String(uploadProgress.failure))}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-elevated)]">
        <div
          className="h-full rounded-full bg-[var(--color-action-bg)] transition-[width]"
          style={{
            width: `${Math.round((done / Math.max(uploadProgress.total, 1)) * 100)}%`,
          }}
        />
      </div>
      <div className="mt-3 space-y-1 text-xs">
        {uploadProgress.queue.map((item, index) => (
          <div
            key={`${item.name}-${index}`}
            className="flex items-center justify-between gap-3"
          >
            <span className="truncate" title={`${item.name} · ${item.message}`}>
              {item.name} · {item.message}
            </span>
            <span
              className={
                item.status === "success"
                  ? "text-[var(--success)]"
                  : item.status === "error" || item.status === "skipped"
                    ? "text-[var(--danger)]"
                    : item.status === "uploading"
                      ? "text-[var(--color-action)]"
                      : "text-[var(--text-muted)]"
              }
            >
              {item.status === "success"
                ? t("imageBedPage.progress.status.success")
                : item.status === "error" || item.status === "skipped"
                  ? t("imageBedPage.progress.status.error")
                  : item.status === "uploading"
                    ? t("imageBedPage.progress.status.uploading")
                    : t("imageBedPage.progress.status.pending")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
