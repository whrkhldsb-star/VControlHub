"use client";

import { useCallback, useEffect, useState } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { formatDate } from "@/app/files/file-entry-utils";

type VersionItem = {
  id: string;
  versionNumber: number;
  name: string;
  sizeBytes: number;
  checksumSha256: string;
  reason: "UPLOAD" | "EDIT" | "MANUAL" | "RESTORE_POINT";
  note: string | null;
  createdByName: string | null;
  createdAt: string;
};

type Props = {
  fileEntryId: string;
  canWrite: boolean;
  onNotify: (type: "success" | "error" | "info", message: string) => void;
  onRestored?: () => void;
};

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function FileVersionHistoryPanel({
  fileEntryId,
  canWrite,
  onNotify,
  onRestored,
}: Props) {
  const { t, locale } = useI18n();
  const [versions, setVersions] = useState<VersionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await csrfFetch<{ versions: VersionItem[] }>(
        `/api/files/${encodeURIComponent(fileEntryId)}/versions`,
      );
      setVersions(data.versions ?? []);
    } catch (error) {
      onNotify(
        "error",
        error instanceof Error
          ? error.message
          : t("fileVersionHistory.loadError"),
      );
    } finally {
      setLoading(false);
    }
  }, [fileEntryId, onNotify, t]);

  /* eslint-disable react-hooks/set-state-in-effect -- initial/remote list fetch on file change */
  useEffect(() => {
    void load();
  }, [load]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function createManual() {
    setBusyId("manual");
    try {
      await csrfFetch(`/api/files/${encodeURIComponent(fileEntryId)}/versions`, {
        method: "POST",
        body: JSON.stringify({ note: note.trim() || null }),
      });
      setNote("");
      onNotify("success", t("fileVersionHistory.snapshotCreated"));
      await load();
    } catch (error) {
      onNotify(
        "error",
        error instanceof Error
          ? error.message
          : t("fileVersionHistory.snapshotError"),
      );
    } finally {
      setBusyId(null);
    }
  }

  async function restore(versionId: string, versionNumber: number) {
    const ok = window.confirm(
      t("fileVersionHistory.restoreConfirm").replace(
        "{n}",
        String(versionNumber),
      ),
    );
    if (!ok) return;
    setBusyId(versionId);
    try {
      await csrfFetch(
        `/api/files/${encodeURIComponent(fileEntryId)}/versions/${encodeURIComponent(versionId)}/restore`,
        { method: "POST" },
      );
      onNotify("success", t("fileVersionHistory.restoreSuccess"));
      await load();
      onRestored?.();
    } catch (error) {
      onNotify(
        "error",
        error instanceof Error
          ? error.message
          : t("fileVersionHistory.restoreError"),
      );
    } finally {
      setBusyId(null);
    }
  }

  function reasonLabel(reason: VersionItem["reason"]) {
    return t(`fileVersionHistory.reason.${reason}`);
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-[var(--text-secondary)]">
          {t("fileVersionHistory.title")}
        </h3>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
        >
          {t("fileVersionHistory.refresh")}
        </button>
      </div>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        {t("fileVersionHistory.description")}
      </p>

      {canWrite ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("fileVersionHistory.notePlaceholder")}
            className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-xs text-[var(--text-primary)]"
          />
          <button
            type="button"
            disabled={busyId === "manual"}
            onClick={() => void createManual()}
            data-tone="cyan"
            className="rounded-xl border border-[var(--color-action-border)]/30 px-3 py-2 text-xs font-medium text-[var(--color-action-fg)] hover:bg-[var(--color-action-bg)]/15 disabled:opacity-50"
          >
            {busyId === "manual"
              ? t("fileVersionHistory.snapshotPending")
              : t("fileVersionHistory.snapshotNow")}
          </button>
        </div>
      ) : null}

      <div className="mt-3 space-y-2">
        {loading ? (
          <p className="text-xs text-[var(--text-muted)]">
            {t("fileVersionHistory.loading")}
          </p>
        ) : versions.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-[var(--border)] px-3 py-4 text-xs text-[var(--text-muted)]">
            {t("fileVersionHistory.empty")}
          </p>
        ) : (
          versions.map((v) => (
            <div
              key={v.id}
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--text-primary)]">
                    v{v.versionNumber} · {reasonLabel(v.reason)}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                    {formatDate(v.createdAt, locale)} · {formatBytes(v.sizeBytes)}
                    {v.createdByName ? ` · ${v.createdByName}` : ""}
                  </p>
                  {v.note ? (
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">
                      {v.note}
                    </p>
                  ) : null}
                  <p className="mt-1 truncate font-mono text-[10px] text-[var(--text-muted)]">
                    sha256:{v.checksumSha256.slice(0, 16)}…
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <a
                    href={`/api/files/${encodeURIComponent(fileEntryId)}/versions/${encodeURIComponent(v.id)}/download`}
                    className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
                  >
                    {t("fileVersionHistory.download")}
                  </a>
                  {canWrite ? (
                    <button
                      type="button"
                      disabled={busyId === v.id}
                      onClick={() => void restore(v.id, v.versionNumber)}
                      className="rounded-lg border border-[var(--warning-border)] px-2.5 py-1 text-xs text-[var(--warning)] hover:bg-[var(--warning-bg)] disabled:opacity-50"
                    >
                      {busyId === v.id
                        ? t("fileVersionHistory.restorePending")
                        : t("fileVersionHistory.restore")}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
