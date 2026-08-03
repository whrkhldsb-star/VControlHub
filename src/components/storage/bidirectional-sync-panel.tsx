"use client";

import { useCallback, useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { useI18n } from "@/lib/i18n/use-locale";
import { normalizeSyncEndpointPath } from "@/lib/sync/bidirectional";
import { UI_INPUT } from "@/lib/ui/classes";
import { getErrorMessage } from "@/lib/http/error-message";
import { ActionButton } from "@/components/action-button";
import { Notice } from "@/components/ui-primitives";
import { api } from "@/lib/http/api-client";
import { useResourcePolling } from "@/lib/http/use-resource-polling";

type ServerOption = { id: string; name: string; host: string | null };

type SyncJobRow = {
  id: string;
  name: string;
  syncType: string;
  status: string;
  sourcePath: string;
  targetPath: string;
  schedule: string | null;
  deleteOrphans: boolean;
  lastSyncAt: string | null;
  lastSyncResult: string | null;
  sourceServer: { id: string; name: string; host: string | null };
  targetServer: { id: string; name: string; host: string | null };
};

type ReportPayload = {
  report: {
    summary: {
      mode: string;
      transferredFiles: number;
      durationSec: number;
      notes: string[];
      legs: { direction: string; transferredFiles: number }[];
    } | null;
    conflictHints: string[];
    history: {
      id: string;
      status: string;
      filesTransferred: number;
      durationMs: number;
      startedAt: string;
      errorMessage: string | null;
    }[];
  };
};

const SCHEDULES = [
  { value: "manual", key: "filesPage.syncJobs.schedule.manual" },
  { value: "every:15m", key: "filesPage.syncJobs.schedule.every15m" },
  { value: "every:1h", key: "filesPage.syncJobs.schedule.every1h" },
  { value: "every:6h", key: "filesPage.syncJobs.schedule.every6h" },
  { value: "every:24h", key: "filesPage.syncJobs.schedule.every24h" },
] as const;

export function BidirectionalSyncPanel({ servers }: { servers: ServerOption[] }) {
  const { t } = useI18n();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; label: string } | null>(null);
  const [name, setName] = useState("");
  const [sourceServerId, setSourceServerId] = useState(servers[0]?.id ?? "");
  const [targetServerId, setTargetServerId] = useState(servers[1]?.id ?? servers[0]?.id ?? "");
  const [sourcePath, setSourcePath] = useState("/data/share");
  const [targetPath, setTargetPath] = useState("/data/share");
  const [syncType, setSyncType] = useState<"MIRROR" | "BIDIRECTIONAL">("BIDIRECTIONAL");
  const [schedule, setSchedule] = useState("manual");
  const [reportJobId, setReportJobId] = useState<string | null>(null);
  const [report, setReport] = useState<ReportPayload["report"] | null>(null);

  const fetchJobs = useCallback(async () => {
    const data = await api.get<{ jobs?: SyncJobRow[] }>("/api/sync-jobs");
    return data.jobs ?? [];
  }, []);
  const getLoadError = useCallback(
    (cause: unknown) => getErrorMessage(cause, t("filesPage.syncJobs.loadFailed")),
    [t],
  );
  const { data, loading, error: loadError, refresh: load } = useResourcePolling({
    fetcher: fetchJobs,
    intervalSeconds: 0,
    getErrorMessage: getLoadError,
  });
  const jobs = data ?? [];
  const error = actionError ?? loadError;

  const sameEndpoint =
    Boolean(sourceServerId) &&
    sourceServerId === targetServerId &&
    normalizeSyncEndpointPath(sourcePath) === normalizeSyncEndpointPath(targetPath);

  const createJob = async () => {
    setActionError(null);
    if (sameEndpoint) {
      setActionError(t("filesPage.syncJobs.sameEndpoint"));
      return;
    }
    setBusyId("create");
    try {
      await api.post("/api/sync-jobs", {
        name: name.trim() || t("filesPage.syncJobs.defaultName"),
        sourceServerId,
        targetServerId,
        sourcePath,
        targetPath,
        syncType,
        schedule: schedule === "manual" ? null : schedule,
        deleteOrphans: false,
        compress: false,
      });
      setName("");
      await load();
    } catch (e) {
      setActionError(getErrorMessage(e, t("filesPage.syncJobs.createFailed")));
    } finally {
      setBusyId(null);
    }
  };

  const runJob = async (id: string) => {
    setBusyId(id);
    setActionError(null);
    try {
      await api.post(`/api/sync-jobs/${id}/run`);
      await load();
    } catch (e) {
      setActionError(getErrorMessage(e, t("filesPage.syncJobs.runFailed")));
    } finally {
      setBusyId(null);
    }
  };

  const patchSchedule = async (id: string, next: string) => {
    setBusyId(`sch-${id}`);
    setActionError(null);
    try {
      await api.patch(`/api/sync-jobs/${id}`, { schedule: next === "manual" ? null : next });
      await load();
    } catch (e) {
      setActionError(getErrorMessage(e, t("filesPage.syncJobs.scheduleFailed")));
    } finally {
      setBusyId(null);
    }
  };

  const openReport = async (id: string) => {
    setBusyId(`rep-${id}`);
    setActionError(null);
    try {
      const data = await api.get<ReportPayload>(`/api/sync-jobs/${id}/report`);
      setReportJobId(id);
      setReport(data.report);
    } catch (e) {
      setActionError(getErrorMessage(e, t("filesPage.syncJobs.reportFailed")));
    } finally {
      setBusyId(null);
    }
  };

  const removeJob = async (id: string) => {
    setBusyId(id);
    setActionError(null);
    try {
      await api.delete(`/api/sync-jobs/${id}`);
      if (reportJobId === id) {
        setReportJobId(null);
        setReport(null);
      }
      await load();
    } catch (e) {
      setActionError(getErrorMessage(e, t("filesPage.syncJobs.deleteFailed")));
    } finally {
      setBusyId(null);
      setPendingDelete(null);
    }
  };

  return (
    <div className="space-y-4">
      {error ? (
        <Notice tone="danger" compact>{error}</Notice>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        <input
          className={UI_INPUT}
          aria-label={t("filesPage.syncJobs.namePlaceholder")}
          placeholder={t("filesPage.syncJobs.namePlaceholder")}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select
          className={UI_INPUT}
          aria-label={t("filesPage.syncJobs.typeLabel")}
          value={syncType}
          onChange={(e) => setSyncType(e.target.value as "MIRROR" | "BIDIRECTIONAL")}
        >
          <option value="BIDIRECTIONAL">{t("filesPage.syncJobs.type.bidirectional")}</option>
          <option value="MIRROR">{t("filesPage.syncJobs.type.mirror")}</option>
        </select>
        <select aria-label={t("filesPage.syncJobs.scheduleLabel")} className={UI_INPUT} value={schedule} onChange={(e) => setSchedule(e.target.value)}>
          {SCHEDULES.map((s) => (
            <option key={s.value} value={s.value}>
              {t(s.key)}
            </option>
          ))}
        </select>
        <select
          className={UI_INPUT}
          aria-label={t("filesPage.syncJobs.source")}
          value={sourceServerId}
          onChange={(e) => setSourceServerId(e.target.value)}
        >
          {servers.map((s) => (
            <option key={s.id} value={s.id}>
              {t("filesPage.syncJobs.source")}: {s.name}
            </option>
          ))}
        </select>
        <select
          className={UI_INPUT}
          aria-label={t("filesPage.syncJobs.target")}
          value={targetServerId}
          onChange={(e) => setTargetServerId(e.target.value)}
        >
          {servers.map((s) => (
            <option key={s.id} value={s.id}>
              {t("filesPage.syncJobs.target")}: {s.name}
            </option>
          ))}
        </select>
        <input
          className={UI_INPUT}
          aria-label={t("filesPage.syncJobs.sourcePath")}
          value={sourcePath}
          onChange={(e) => setSourcePath(e.target.value)}
          placeholder={t("filesPage.syncJobs.sourcePath")}
        />
        <input
          className={UI_INPUT}
          aria-label={t("filesPage.syncJobs.targetPath")}
          value={targetPath}
          onChange={(e) => setTargetPath(e.target.value)}
          placeholder={t("filesPage.syncJobs.targetPath")}
        />
      </div>
      <ActionButton variant="secondary"
        disabled={
          !sourceServerId ||
          !targetServerId ||
          sameEndpoint ||
          busyId === "create" ||
          servers.length === 0
        }
        onClick={() => void createJob()}
       
        className="!px-3 !py-1.5 !text-xs disabled:opacity-50"
      >
        {busyId === "create" ? t("filesPage.syncJobs.creating") : t("filesPage.syncJobs.create")}
      </ActionButton>
      {sameEndpoint ? (
        <p className="text-xs text-[var(--warning)]">{t("filesPage.syncJobs.sameEndpoint")}</p>
      ) : null}
      {servers.length < 1 ? (
        <p className="text-xs text-[var(--text-muted)]">{t("filesPage.syncJobs.needServers")}</p>
      ) : null}

      <div className="space-y-2">
        {loading ? (
          <p className="text-xs text-[var(--text-muted)]">{t("filesPage.syncJobs.loading")}</p>
        ) : jobs.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">{t("filesPage.syncJobs.empty")}</p>
        ) : (
          jobs.map((job) => (
            <div
              key={job.id}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-medium text-[var(--text-primary)]">{job.name}</span>
                  <span className="ml-2 text-[var(--text-muted)]">
                    {job.syncType} · {job.status} · {job.schedule || "manual"}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <select
                    className={`${UI_INPUT} !py-1 !text-xs`}
                    aria-label={t("filesPage.syncJobs.scheduleLabel")}
                    value={job.schedule || "manual"}
                    disabled={busyId === `sch-${job.id}`}
                    onChange={(e) => void patchSchedule(job.id, e.target.value)}
                  >
                    {SCHEDULES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {t(s.key)}
                      </option>
                    ))}
                  </select>
                  <ActionButton variant="secondary" className="!rounded-md !px-2 !py-1 !text-xs disabled:opacity-50"
                    disabled={busyId === `rep-${job.id}`}
                    onClick={() => void openReport(job.id)}
                  >
                    {t("filesPage.syncJobs.report")}
                  </ActionButton>
                  <ActionButton variant="secondary" className="!rounded-md !px-2 !py-1 !text-xs disabled:opacity-50"
                    disabled={busyId === job.id || job.status === "RUNNING"}
                    onClick={() => void runJob(job.id)}
                  >
                    {t("filesPage.syncJobs.run")}
                  </ActionButton>
                  <ActionButton variant="secondary" className="!rounded-md !px-2 !py-1 !text-xs disabled:opacity-50"
                    disabled={busyId === job.id}
                    onClick={() => setPendingDelete({ id: job.id, label: job.name?.trim() || job.id })}
                  >
                    {t("filesPage.syncJobs.delete")}
                  </ActionButton>
                </div>
              </div>
              <p className="mt-1 text-[var(--text-muted)]">
                {job.sourceServer.name}:{job.sourcePath} {job.syncType === "BIDIRECTIONAL" ? "↔" : "→"} {job.targetServer.name}:{job.targetPath}
              </p>
              {job.lastSyncResult ? (
                <p className="mt-1 text-[var(--text-secondary)]">{job.lastSyncResult}</p>
              ) : null}
              {reportJobId === job.id && report ? (
                <div className="mt-2 rounded border border-[var(--border)] bg-[var(--surface-elevated)] p-2">
                  <p className="font-medium text-[var(--text-primary)]">
                    {t("filesPage.syncJobs.reportTitle")}
                  </p>
                  {report.summary ? (
                    <p className="mt-1 text-[var(--text-secondary)]">
                      {report.summary.mode}: {report.summary.transferredFiles} files /{" "}
                      {report.summary.durationSec}s
                    </p>
                  ) : null}
                  {report.conflictHints.length > 0 ? (
                    <ul className="mt-1 list-disc pl-4 text-[var(--text-muted)]">
                      {report.conflictHints.map((h) => (
                        <li key={h}>{h}</li>
                      ))}
                    </ul>
                  ) : null}
                  {report.history.length > 0 ? (
                    <div className="mt-2 space-y-1">
                      <p className="text-[var(--text-muted)]">{t("filesPage.syncJobs.history")}</p>
                      {report.history.slice(0, 5).map((h) => (
                        <p key={h.id} className="text-[var(--text-secondary)]">
                          {h.startedAt.slice(0, 19)} · {h.status} · xfer {h.filesTransferred} ·{" "}
                          {Math.round(h.durationMs / 1000)}s
                          {h.errorMessage ? ` · ${h.errorMessage}` : ""}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={t("filesPage.syncJobs.delete")}
        description={t("filesPage.syncJobs.deleteConfirm", { name: pendingDelete?.label ?? "" })}
        cancelLabel={t("common.cancel")}
        confirmLabel={t("filesPage.syncJobs.delete")}
        busy={Boolean(pendingDelete && busyId === pendingDelete.id)}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) void removeJob(pendingDelete.id);
        }}
      />
    </div>
  );
}
