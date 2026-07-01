"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useI18n } from "@/lib/i18n/use-locale";
import { ServerCardActions } from "./server-card-actions";
import { useAutoProbeSettings } from "./auto-probe-context";
import { ServerOverviewDetailsLazy } from "./server-overview-details-lazy";

type DiagnosticRunState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; summary: string; checkedAt: string }
  | { status: "error"; message: string; checkedAt: string };

type ServerOverviewCardProps = {
  server: {
    id: string;
    name: string;
    host: string;
    port: number;
    username: string;
    description?: string | null;
    tags?: string[] | null;
    enabled: boolean;
    connectionType: "SSH_KEY" | "PASSWORD";
    connectionSummary: string;
    connectionTypeLabel: string;
    statusLabel: string;
    pendingCommandCount: number;
    targetCount: number;
    latestCommands: Array<{
      id: string;
      title: string;
      initiatedByType: string;
      requestStatus: string;
      targetStatus: string;
    }>;
    sshKey: { name: string; fingerprint?: string | null } | null;
    storageNode?: { id: string; name: string; basePath: string } | null;
    directGateway?: {
      enabled: boolean;
      statusLabel: string;
      publicUrl: string | null;
      port: number;
    } | null;
    // TR-041: OS dialect + info
    osDialect?: string | null;
    osInfo?: string | null;
  };
  sessionToken: string;
  canManageServers: boolean;
  canUseSshTerminal: boolean;
};

export function ServerOverviewCard({
  server,
  sessionToken,
  canManageServers,
  canUseSshTerminal,
}: ServerOverviewCardProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [diagnosticRun, setDiagnosticRun] = useState<DiagnosticRunState>({ status: "idle" });
  const directLabel = server.directGateway?.statusLabel ?? t("serverOverviewCard.websiteRelay");
  const detailsId = `server-details-${server.id}`;

  // Status badge reflects the latest live probe outcome instead of the static
  // "启用 · 待探测" placeholder. This is what the user expects after clicking
  // "运行实时探测" — they want to see the chip change to 在线/离线/检测中.
  let listHealthLabel: string;
  let listHealthToneClass: string;
  let listHealthDescription: string;
  if (!server.enabled) {
    listHealthLabel = t("serverOverviewCard.disabled");
    listHealthToneClass =
      "border-slate-400/20 bg-slate-400/10 text-[var(--text-muted)]";
    listHealthDescription =
      t("serverOverviewCard.disabledDescription");
  } else if (diagnosticRun.status === "loading") {
    listHealthLabel = t("serverOverviewCard.checking");
    listHealthToneClass =
      "border-sky-400/30 bg-sky-400/10 text-sky-200 light:border-sky-700/30 light:bg-sky-50";
    listHealthDescription = t("serverOverviewCard.checkingDescription");
  } else if (diagnosticRun.status === "success") {
    listHealthLabel = `在线 · ${diagnosticRun.checkedAt.split(" ").pop() ?? ""}`.trim();
    listHealthToneClass =
      "border-emerald-400/30 bg-emerald-400/10 text-emerald-200 light:border-emerald-700/30 light:bg-emerald-50";
    listHealthDescription =
      diagnosticRun.summary
        ? `最近一次实时探测成功：${diagnosticRun.summary}（${diagnosticRun.checkedAt}）`
        : `最近一次实时探测成功（${diagnosticRun.checkedAt}）`;
  } else if (diagnosticRun.status === "error") {
    listHealthLabel = t("serverOverviewCard.offline");
    listHealthToneClass =
      "border-rose-400/30 bg-rose-400/10 text-rose-200 light:border-rose-700/30 light:bg-rose-50";
    listHealthDescription = `最近一次实时探测失败：${diagnosticRun.message}（${diagnosticRun.checkedAt}）`;
  } else {
    listHealthLabel = t("serverOverviewCard.enabledPendingProbe");
    listHealthToneClass =
      "border-amber-400/20 bg-amber-400/10 text-amber-100 light:border-amber-700/25 light:bg-amber-50";
    listHealthDescription =
      t("serverOverviewCard.enabledPendingProbeDescription");
  }

  const runRealtimeDiagnostics = useCallback(async () => {
    setDiagnosticRun({ status: "loading" });
    try {
      const response = await fetch(`/api/servers/monitor?serverId=${encodeURIComponent(server.id)}`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      const checkedAt = new Date().toLocaleString("zh-CN", { hour12: false });

      if (!response.ok) {
        setDiagnosticRun({
          status: "error",
          message: payload?.error ?? `监控接口返回 ${response.status}`,
          checkedAt,
        });
        return;
      }
      if (payload?.error) {
        setDiagnosticRun({ status: "error", message: payload.error, checkedAt });
        return;
      }

      const diskText = Array.isArray(payload?.disk) && payload.disk.length > 0
        ? `，磁盘 ${payload.disk[0].mount} ${payload.disk[0].usagePercent}%`
        : "";
      setDiagnosticRun({
        status: "success",
        summary: `CPU ${payload?.cpu?.usagePercent ?? "--"}% · 内存 ${payload?.memory?.usagePercent ?? "--"}%${diskText}`,
        checkedAt,
      });
    } catch (error) {
      setDiagnosticRun({
        status: "error",
        message: error instanceof Error ? error.message : t("serverOverviewCard.realtimeProbeFailed"),
        checkedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
      });
    }
  }, [server.id, t]);

  // ---------------------------------------------------------------------
  // 自动探测：受 AutoProbeContext 控制，挂载/切回页面时跑一次 + 周期刷新。
  // 仅在节点启用、设置 hydrated、用户开启自动探测时生效。
  // 用 ref 跟踪「是否正在跑」，避免周期触发与上次未完成请求并发。
  // ---------------------------------------------------------------------
  const { enabled: autoProbeEnabled, intervalSec, hydrated } = useAutoProbeSettings();
  const inFlightRef = useRef(false);
  const runRef = useRef(runRealtimeDiagnostics);
  useEffect(() => {
    runRef.current = runRealtimeDiagnostics;
  }, [runRealtimeDiagnostics]);

  useEffect(() => {
    if (!hydrated) return;
    if (!autoProbeEnabled) return;
    if (!server.enabled) return;

    const trigger = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        await runRef.current();
      } finally {
        inFlightRef.current = false;
      }
    };

    void trigger();
    const ms = Math.max(5, intervalSec) * 1000;
    const handle = window.setInterval(() => {
      void trigger();
    }, ms);
    return () => {
      window.clearInterval(handle);
    };
  }, [autoProbeEnabled, intervalSec, hydrated, server.enabled, server.id]);

  return (
    <article data-card className="bg-[var(--surface)]/[0.025] p-3 transition-colors hover:bg-[var(--surface)]/[0.04]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${server.enabled ? "bg-emerald-400" : "bg-slate-500"}`}
              aria-hidden="true"
            />
            <h2 className="truncate text-sm font-semibold text-[var(--text-primary)]">
              {server.name}
            </h2>
          </div>
          <p className="mt-1 truncate text-[11px] text-[var(--text-muted)]" title={`${server.username}@${server.host}:${server.port}`}>
            {server.username}@{server.host}:{server.port}
          </p>
        </div>
        <span
          role="status"
          aria-label={`节点实时状态：${listHealthLabel}`}
          title={listHealthDescription}
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${listHealthToneClass}`}
        >
          {listHealthLabel}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-[var(--text-muted)]">
        <CompactField label={t("serverOverviewCard.connection")} value={server.connectionTypeLabel} />
        <CompactField
          label={t("serverOverviewCard.key")}
          value={server.sshKey ? server.sshKey.name : t("serverOverviewCard.notConfigured")}
        />
        <CompactField label={t("serverOverviewCard.direct")} value={directLabel} />
        <CompactField
          label={t("serverOverviewCard.pendingApproval")}
          value={`${server.pendingCommandCount} ${t("serverOverviewCard.itemsCount")}`}
        />
      </div>
      <p data-tone="amber" className="mt-2 rounded-lg border border-amber-400/10 px-2 py-1.5 text-[11px] leading-5 text-[var(--text-muted)] light:border-amber-700/15 light:bg-amber-50">
        {listHealthDescription}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {server.enabled && canUseSshTerminal ? (
          <ServerCardActions
            serverId={server.id}
            serverName={server.name}
            host={server.host}
            port={server.port}
            username={server.username}
            connectionType={server.connectionType as "SSH_KEY" | "PASSWORD"}
            description={server.description ?? null}
            tags={server.tags ?? []}
            enabled={server.enabled}
            sessionToken={sessionToken}
            canManageServers={false}
            canUseSshTerminal={canUseSshTerminal}
          />
        ) : null}
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-controls={detailsId}
          className="rounded-full border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3 py-1 text-xs text-[var(--text-secondary)] transition hover:bg-[var(--surface)]/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 light:hover:bg-slate-100"
        >
          {expanded ? t("serverOverviewCard.collapseDetails") : t("serverOverviewCard.viewDetails")}
        </button>
      </div>

      {expanded ? (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/55 px-3 py-6 backdrop-blur-sm sm:px-6" onClick={() => setExpanded(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${detailsId}-title`}
            className="w-full max-w-5xl rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 text-[var(--text-primary)] shadow-2xl sm:p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-3 border-b border-[var(--border)] pb-3">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--text-muted)]">VPS Detail</p>
                <h3 id={`${detailsId}-title`} className="truncate text-base font-semibold text-[var(--text-primary)]">
                  {server.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition hover:bg-[var(--surface)]/[0.08]"
              >
                {t("serverOverviewCard.collapseDetails")}
              </button>
            </div>
            <div className="max-h-[78vh] overflow-y-auto pr-1">
              <ServerOverviewDetailsLazy
                server={server}
                sessionToken={sessionToken}
                canManageServers={canManageServers}
                canUseSshTerminal={canUseSshTerminal}
                directLabel={directLabel}
                detailsId={detailsId}
                diagnosticRun={diagnosticRun}
                onRunRealtimeDiagnostics={runRealtimeDiagnostics}
              />
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function CompactField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-2 py-1.5">
      <div className="text-[10px] text-[var(--text-muted)]">{label}</div>
      <div className="truncate text-[11px] text-[var(--text-secondary)]">{value}</div>
    </div>
  );
}
