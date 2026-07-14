"use client";

import { useCallback, useEffect, useState } from "react";

import { useI18n } from "@/lib/i18n/use-locale";

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
  const { t } = useI18n();
  const [downloads, setDownloads] = useState<RecentDownload[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/downloads/recent", { cache: "no-store" });
      if (!response.ok) throw new Error(t("filesPage.recentDownloads.error"));
      const body = await response.json() as { downloads?: RecentDownload[] };
      setDownloads(Array.isArray(body.downloads) ? body.downloads : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("filesPage.recentDownloads.error"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <section data-card aria-labelledby="recent-downloads-title" className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="recent-downloads-title" className="text-base font-semibold text-[var(--text-primary)]">
            {t("filesPage.recentDownloads.title")}
          </h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">{t("filesPage.recentDownloads.description")}</p>
        </div>
        <button
          type="button"
          aria-label={t("filesPage.recentDownloads.refreshAria")}
          onClick={() => void load()}
          disabled={loading}
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-60"
        >
          {t("filesPage.recentDownloads.refresh")}
        </button>
      </div>

      {loading ? <p className="mt-4 text-sm text-[var(--text-muted)]">{t("filesPage.recentDownloads.loading")}</p> : null}
      {!loading && error ? (
        <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--danger-border)] bg-[var(--danger-bg)] px-4 py-3 text-sm text-[var(--danger)]">
          <span>{error}</span>
          <button type="button" onClick={() => void load()} className="rounded-lg border border-[var(--danger-border)] px-3 py-1.5 font-medium">
            {t("filesPage.recentDownloads.retry")}
          </button>
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
                <span className="mt-1 block text-xs text-[var(--text-muted)]">{new Date(download.completedAt).toLocaleString()}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
