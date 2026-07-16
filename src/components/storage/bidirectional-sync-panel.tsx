"use client";

import { useCallback, useEffect, useState } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { UI_INPUT } from "@/lib/ui/classes";

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
  const [jobs, setJobs] = useState<SyncJobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [sourceServerId, setSourceServerId] = useState(servers[0]?.id ?? "");
  const [targetServerId, setTargetServerId] = useState(servers[1]?.id ?? servers[0]?.id ?? "");
  const [sourcePath, setSourcePath] = useState("/data/share");
  const [targetPath, setTargetPath] = useState("/data/share");
  const [syncType, setSyncType] = useState<"MIRROR" | "BIDIRECTIONAL">("BIDIRECTIONAL");
  const [schedule, setSchedule] = useState("manual");
  const [reportJobId, setReportJobId] = useState<string | null>(null);
  const [report, setReport] = useState<ReportPayload["report"] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sync-jobs", { credentials: "include" });
      const data = (await res.json().catch(() => ({}))) as { jobs?: SyncJobRow[]; error?: string };
      if (!res.ok) throw new Error(data.error || t("filesPage.syncJobs.loadFailed"));
      setJobs(data.jobs ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("filesPage.syncJobs.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/sync-jobs", { credentials: "include" });
        const data = (await res.json().catch(() => ({}))) as { jobs?: SyncJobRow[]; error?: string };
        if (cancelled) return;
        if (!res.ok) setError(data.error || t("filesPage.syncJobs.loadFailed"));
        else setJobs(data.jobs ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t("filesPage.syncJobs.loadFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bootstrap once
  }, []);

  const createJob = async () => {
    setError(null);
    setBusyId("create");
    try {
      const res = await csrfFetch("/api/sync-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || t("filesPage.syncJobs.defaultName"),
          sourceServerId,
          targetServerId,
          sourcePath,
          targetPath,
          syncType,
          schedule: schedule === "manual" ? null : schedule,
          deleteOrphans: false,
          compress: false,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || t("filesPage.syncJobs.createFailed"));
      setName("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("filesPage.syncJobs.createFailed"));
    } finally {
      setBusyId(null);
    }
  };

  const runJob = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      const res = await csrfFetch(`/api/sync-jobs/${id}/run`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || t("filesPage.syncJobs.runFailed"));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("filesPage.syncJobs.runFailed"));
    } finally {
      setBusyId(null);
    }
  };

  const patchSchedule = async (id: string, next: string) => {
    setBusyId(`sch-${id}`);
    setError(null);
    try {
      const res = await csrfFetch(`/api/sync-jobs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schedule: next === "manual" ? null : next }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || t("filesPage.syncJobs.scheduleFailed"));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("filesPage.syncJobs.scheduleFailed"));
    } finally {
      setBusyId(null);
    }
  };

  const openReport = async (id: string) => {
    setBusyId(`rep-${id}`);
    setError(null);
    try {
      const res = await fetch(`/api/sync-jobs/${id}/report`, { credentials: "include" });
      const data = (await res.json().catch(() => ({}))) as ReportPayload & { error?: string };
      if (!res.ok) throw new Error(data.error || t("filesPage.syncJobs.reportFailed"));
      setReportJobId(id);
      setReport(data.report);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("filesPage.syncJobs.reportFailed"));
    } finally {
      setBusyId(null);
    }
  };

  const removeJob = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      const res = await csrfFetch(`/api/sync-jobs/${id}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || t("filesPage.syncJobs.deleteFailed"));
      if (reportJobId === id) {
        setReportJobId(null);
        setReport(null);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("filesPage.syncJobs.deleteFailed"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          {t("filesPage.syncJobs.title")}
        </h3>
        <p className="mt-1 text-xs text-[var(--text-muted)]">{t("filesPage.syncJobs.desc")}</p>
      </div>

      {error ? (
        <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        <input
          className={UI_INPUT}
          placeholder={t("filesPage.syncJobs.namePlaceholder")}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select
          className={UI_INPUT}
          value={syncType}
          onChange={(e) => setSyncType(e.target.value as "MIRROR" | "BIDIRECTIONAL")}
        >
          <option value="BIDIRECTIONAL">{t("filesPage.syncJobs.type.bidirectional")}</option>
          <option value="MIRROR">{t("filesPage.syncJobs.type.mirror")}</option>
        </select>
        <select className={UI_INPUT} value={schedule} onChange={(e) => setSchedule(e.target.value)}>
          {SCHEDULES.map((s) => (
            <option key={s.value} value={s.value}>
              {t(s.key)}
            </option>
          ))}
        </select>
        <select
          className={UI_INPUT}
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
          value={sourcePath}
          onChange={(e) => setSourcePath(e.target.value)}
          placeholder={t("filesPage.syncJobs.sourcePath")}
        />
        <input
          className={UI_INPUT}
          value={targetPath}
          onChange={(e) => setTargetPath(e.target.value)}
          placeholder={t("filesPage.syncJobs.targetPath")}
        />
      </div>
      <button
        type="button"
        className="rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
        disabled={!sourceServerId || !targetServerId || busyId === "create" || servers.length === 0}
        onClick={() => void createJob()}
      >
        {busyId === "create" ? t("filesPage.syncJobs.creating") : t("filesPage.syncJobs.create")}
      </button>
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
                  <button
                    type="button"
                    className="rounded border border-[var(--border)] px-2 py-1 hover:bg-[var(--surface-hover)] disabled:opacity-50"
                    disabled={busyId === `rep-${job.id}`}
                    onClick={() => void openReport(job.id)}
                  >
                    {t("filesPage.syncJobs.report")}
                  </button>
                  <button
                    type="button"
                    className="rounded border border-[var(--border)] px-2 py-1 hover:bg-[var(--surface-hover)] disabled:opacity-50"
                    disabled={busyId === job.id || job.status === "RUNNING"}
                    onClick={() => void runJob(job.id)}
                  >
                    {t("filesPage.syncJobs.run")}
                  </button>
                  <button
                    type="button"
                    className="rounded border border-[var(--border)] px-2 py-1 hover:bg-[var(--surface-hover)] disabled:opacity-50"
                    disabled={busyId === job.id}
                    onClick={() => void removeJob(job.id)}
                  >
                    {t("filesPage.syncJobs.delete")}
                  </button>
                </div>
              </div>
              <p className="mt-1 text-[var(--text-muted)]">
                {job.sourceServer.name}:{job.sourcePath} ↔ {job.targetServer.name}:{job.targetPath}
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
    </div>
  );
}
