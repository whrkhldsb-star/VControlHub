"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toDateLocale } from "@/lib/i18n/locale-format";

import { useI18n } from "@/lib/i18n/use-locale";
import { useDialogFocus } from "@/lib/a11y/use-dialog-focus";
import { useVisibilityInterval } from "@/lib/hooks/use-visibility-interval";
import { ServerCardActions } from "./server-card-actions";
import { useAutoProbeSettings } from "./auto-probe-context";
import { ServerOverviewDetails } from "./server-overview-details";

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
    // TR-031: monthly VPS cost auto-sync settings
    costAutoSync?: boolean;
    costMonthlyAmount?: string | null;
    costCurrency?: "CNY" | "USD" | "EUR" | "JPY" | "HKD";
    costProvider?: string | null;
    costLastSyncedAt?: string | null;
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
  const { locale, t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [isPending, startTransition] = useTransition();
  const closeDialog = useCallback(() => {
    startTransition(() => setExpanded(false));
  }, []);
  const openDialog = useCallback(() => {
    startTransition(() => setExpanded(true));
  }, []);
  const dialogRef = useDialogFocus<HTMLDivElement>({ open: expanded, onClose: closeDialog });
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
      "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]";
    listHealthDescription =
      t("serverOverviewCard.disabledDescription");
  } else if (diagnosticRun.status === "loading") {
    listHealthLabel = t("serverOverviewCard.checking");
    listHealthToneClass =
      "border-[var(--info-border)] bg-[var(--info-bg)] text-[var(--info)] light:border-[var(--info-border)] light:bg-[var(--info)]";
    listHealthDescription = t("serverOverviewCard.checkingDescription");
  } else if (diagnosticRun.status === "success") {
    listHealthLabel = `${t("serverOverviewCard.online")} · ${diagnosticRun.checkedAt.split(" ").pop() ?? ""}`.trim();
    listHealthToneClass =
      "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)] light:border-[var(--success-border)] light:bg-[var(--success)]";
    listHealthDescription =
      diagnosticRun.summary
        ? t("serverOverviewCard.lastProbeSuccessWithSummary").replace("{summary}", diagnosticRun.summary).replace("{checkedAt}", diagnosticRun.checkedAt)
        : t("serverOverviewCard.lastProbeSuccess").replace("{checkedAt}", diagnosticRun.checkedAt);
  } else if (diagnosticRun.status === "error") {
    listHealthLabel = t("serverOverviewCard.offline");
    listHealthToneClass =
      "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger)] light:border-[var(--danger-border)] light:bg-[var(--danger)]";
    listHealthDescription = t("serverOverviewCard.lastProbeFailed").replace("{message}", diagnosticRun.message).replace("{checkedAt}", diagnosticRun.checkedAt);
  } else {
    listHealthLabel = t("serverOverviewCard.enabledPendingProbe");
    listHealthToneClass =
      "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)] light:border-[var(--warning-border)] light:bg-[var(--warning)]";
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
      const checkedAt = new Date().toLocaleString(toDateLocale(locale), { hour12: false });

      if (!response.ok) {
        setDiagnosticRun({
          status: "error",
          message: payload?.error ?? t("serverOverviewCard.monitorStatusReturned").replace("{status}", String(response.status)),
          checkedAt,
        });
        return;
      }
      if (payload?.error) {
        setDiagnosticRun({ status: "error", message: payload.error, checkedAt });
        return;
      }

      const diskText = Array.isArray(payload?.disk) && payload.disk.length > 0
        ? t("serverOverviewCard.diskSummary").replace("{mount}", String(payload.disk[0].mount)).replace("{usage}", String(payload.disk[0].usagePercent))
        : "";
      setDiagnosticRun({
        status: "success",
        summary: t("serverOverviewCard.resourceSummary").replace("{cpu}", String(payload?.cpu?.usagePercent ?? "--")).replace("{memory}", String(payload?.memory?.usagePercent ?? "--")).replace("{disk}", diskText),
        checkedAt,
      });
    } catch (error) {
      setDiagnosticRun({
        status: "error",
        message: error instanceof Error ? error.message : t("serverOverviewCard.realtimeProbeFailed"),
        checkedAt: new Date().toLocaleString(toDateLocale(locale), { hour12: false }),
      });
    }
  }, [server.id, locale, t]);

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
    return undefined;
  }, [autoProbeEnabled, intervalSec, hydrated, server.enabled, server.id]);

  useVisibilityInterval(() => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    void runRef.current().finally(() => { inFlightRef.current = false; });
  }, hydrated && autoProbeEnabled && server.enabled ? Math.max(5, intervalSec) * 1000 : null);

  return (
    <article
      data-card
      data-server-card
      className="group relative overflow-hidden !p-0 transition-colors"
    >
      <div className="absolute inset-x-0 top-0 h-0.5 bg-[linear-gradient(90deg,var(--accent),transparent)] opacity-70" aria-hidden="true" />
      <div className="p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-[var(--surface)] ${server.enabled ? "bg-[var(--success)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--success)_20%,transparent)]" : "bg-[var(--text-disabled)]"}`}
              aria-hidden="true"
            />
            <h2 className="truncate text-sm font-semibold tracking-tight text-[var(--text-primary)]">
              {server.name}
            </h2>
          </div>
          <p className="mt-1.5 truncate font-mono text-[11px] text-[var(--text-muted)]" title={`${server.username}@${server.host}:${server.port}`}>
            {server.username}@{server.host}:{server.port}
          </p>
        </div>
        <span
          role="status"
          aria-label={t("serverOverviewCard.realtimeStatusAria").replace("{status}", listHealthLabel)}
          title={listHealthDescription}
          className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold tracking-wide ${listHealthToneClass}`}
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
      <p className="mt-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-2.5 py-2 text-[11px] leading-5 text-[var(--text-muted)]">
        {listHealthDescription}
      </p>

      <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--border-subtle)] pt-3">
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
          onClick={() => (expanded ? closeDialog() : openDialog())}
          aria-expanded={expanded}
          aria-controls={detailsId}
          disabled={isPending}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:opacity-60"
        >
          {expanded ? t("serverOverviewCard.collapseDetails") : t("serverOverviewCard.viewDetails")}
        </button>
      </div>
      </div>

      {expanded ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 px-3 py-6 backdrop-blur-md sm:px-6" onClick={closeDialog}>
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${detailsId}-title`}
            className="w-full max-w-5xl rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 text-[var(--text-primary)] shadow-2xl sm:p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-3 border-b border-[var(--border)] pb-3">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--text-muted)]">{t("serverOverviewCard.eyebrow")}</p>
                <h3 id={`${detailsId}-title`} className="truncate text-base font-semibold text-[var(--text-primary)]">
                  {server.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeDialog}
                className="shrink-0 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] disabled:opacity-60"
                disabled={isPending}
              >
                {t("serverOverviewCard.collapseDetails")}
              </button>
            </div>
            <div className="max-h-[78vh] overflow-y-auto pr-1">
              <ServerOverviewDetails
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
    <div className="min-w-0 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-2.5 py-1.5">
      <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">{label}</div>
      <div className="mt-0.5 truncate text-[11px] text-[var(--text-secondary)]">{value}</div>
    </div>
  );
}
