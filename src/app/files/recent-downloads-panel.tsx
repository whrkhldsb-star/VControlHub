"use client";

import { useCallback } from "react";

import { useI18n } from "@/lib/i18n/use-locale";
import { ActionButton } from "@/components/action-button";
import { RefreshCw } from "@/components/icons";
import { IconButton } from "@/components/ui-primitives";
import { formatDateTime } from "@/lib/datetime/format";
import { api } from "@/lib/http/api-client";
import { useResourcePolling } from "@/lib/http/use-resource-polling";

type RecentDownload = {
  id: string;
  fileName: string;
  path: string;
  completedAt: string;
  storageNode: { id: string; name: string; driver: string };
};

export function RecentDownloadsPanel({
  onNavigate,
}: {
  onNavigate: (path: string, nodeId: string) => void;
}) {
  const { t, locale } = useI18n();
  const fetchDownloads = useCallback(async () => {
    const body = await api.get<{ downloads?: RecentDownload[] }>("/api/downloads/recent", { cache: "no-store" });
    return Array.isArray(body.downloads) ? body.downloads : [];
  }, []);
  const getLoadError = useCallback(() => t("filesPage.recentDownloads.error"), [t]);
  const { data, loading, refreshing, error, refresh } = useResourcePolling({
    fetcher: fetchDownloads,
    intervalSeconds: 0,
    getErrorMessage: getLoadError,
  });
  const downloads = data ?? [];

  return (
    <section data-card aria-labelledby="recent-downloads-title" className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="recent-downloads-title" className="text-base font-semibold text-[var(--text-primary)]">
            {t("filesPage.recentDownloads.title")}
          </h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">{t("filesPage.recentDownloads.description")}</p>
        </div>
        <IconButton
          label={t("filesPage.recentDownloads.refreshAria")}
          onClick={() => void refresh()}
          disabled={loading || refreshing}
          className="h-9 w-9 shrink-0 border border-[var(--border)] bg-[var(--surface-elevated)]"
        >
          <RefreshCw size={16} className={refreshing ? "animate-spin" : undefined} aria-hidden="true" />
        </IconButton>
      </div>

      {loading ? <p className="mt-4 text-sm text-[var(--text-muted)]">{t("filesPage.recentDownloads.loading")}</p> : null}
      {!loading && error ? (
        <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--danger-border)] bg-[var(--danger-bg)] px-4 py-3 text-sm text-[var(--danger)]">
          <span>{error}</span>
          <ActionButton variant="danger"
            onClick={() => void refresh()}
          
          	className="!px-3 !py-1.5 !text-xs !font-medium"
          >            {t("filesPage.recentDownloads.retry")}
          </ActionButton>
        </div>
      ) : null}
      {!loading && !error && downloads.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-dashed border-[var(--border)] px-4 py-5 text-sm text-[var(--text-muted)]">
          {t("filesPage.recentDownloads.empty")}
        </p>
      ) : null}
      {!loading && !error && downloads.length > 0 ? (
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {downloads.map((download) => (
            <li key={download.id}>
              <button
                type="button"
                onClick={() => onNavigate(download.path, download.storageNode.id)}
                className="w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-4 py-3 text-left transition hover:border-[var(--accent-border)] hover:bg-[var(--surface-hover)]"
              >
                <span className="block truncate text-sm font-medium text-[var(--text-primary)]">{download.fileName}</span>
                <span className="mt-1 block truncate text-xs text-[var(--text-muted)]">
                  {download.storageNode.name} · /{download.path}
                </span>
                <span className="mt-1 block text-xs text-[var(--text-muted)]">{formatDateTime(download.completedAt, locale)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
