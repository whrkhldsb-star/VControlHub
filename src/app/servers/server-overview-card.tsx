"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { useI18n } from "@/lib/i18n/use-locale";
import { ServerCardActions } from "./server-card-actions";
import { useServerDiagnostics } from "./use-server-diagnostics";
import { ActionButton } from "@/components/action-button";
import { ModalShell } from "@/components/modal-shell";
import type {
  ServerOverviewDetailsServer,
} from "./server-overview-details";

// TR-036: defer ServerCardActions/form wiring until the details portal expands.
const ServerOverviewDetails = dynamic(
  () => import("./server-overview-details").then((m) => m.ServerOverviewDetails),
  {
    ssr: false,
    loading: () => <div className="min-h-[240px] rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)]" aria-hidden />,
  },
);

type ServerOverviewCardProps = {
  server: ServerOverviewDetailsServer;
  canManageServers: boolean;
  canUseSshTerminal: boolean;
};

export function ServerOverviewCard({
  server,
  canManageServers,
  canUseSshTerminal,
}: ServerOverviewCardProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  const closeDialog = useCallback(() => {
    setExpanded(false);
  }, []);
  const openDialog = useCallback(() => {
    setExpanded(true);
  }, []);
  const { diagnosticRun, runRealtimeDiagnostics } = useServerDiagnostics(server.id, server.enabled);
  const directLabel = server.directGateway?.statusLabel ?? t("serverOverviewCard.websiteRelay");
  const detailsId = `server-details-${server.id}`;

  useEffect(() => {
    setPortalReady(true);
  }, []);

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
      "border-[var(--info-border)] bg-[var(--info-bg)] text-[var(--info)]";
    listHealthDescription = t("serverOverviewCard.checkingDescription");
  } else if (diagnosticRun.status === "success") {
    listHealthLabel = `${t("serverOverviewCard.online")} · ${diagnosticRun.checkedAt.split(" ").pop() ?? ""}`.trim();
    listHealthToneClass =
      "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)] light:border-[var(--success-border)]";
    listHealthDescription =
      diagnosticRun.summary
        ? t("serverOverviewCard.lastProbeSuccessWithSummary", { summary: diagnosticRun.summary, checkedAt: diagnosticRun.checkedAt })
        : t("serverOverviewCard.lastProbeSuccess", { checkedAt: diagnosticRun.checkedAt });
  } else if (diagnosticRun.status === "error") {
    listHealthLabel = t("serverOverviewCard.offline");
    listHealthToneClass =
      "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger)] light:border-[var(--danger-border)]";
    listHealthDescription = t("serverOverviewCard.lastProbeFailed", { message: diagnosticRun.message, checkedAt: diagnosticRun.checkedAt });
  } else {
    listHealthLabel = t("serverOverviewCard.enabledPendingProbe");
    listHealthToneClass =
      "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)] light:border-[var(--warning-border)]";
    listHealthDescription =
      t("serverOverviewCard.enabledPendingProbeDescription");
  }

  return (
    <article
      data-card
      data-server-card
      className="group relative overflow-hidden !p-0 transition-colors"
    >
      <div className="flex h-full flex-col p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-[var(--surface)] ${
                !server.enabled
                  ? "bg-[var(--text-disabled)]"
                  : diagnosticRun.status === "success"
                    ? "bg-[var(--success)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--success)_20%,transparent)]"
                    : diagnosticRun.status === "error"
                      ? "bg-[var(--danger)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--danger)_20%,transparent)]"
                      : diagnosticRun.status === "loading"
                        ? "bg-[var(--info)] animate-pulse shadow-[0_0_0_3px_color-mix(in_srgb,var(--info)_20%,transparent)]"
                        : "bg-[var(--warning)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--warning)_20%,transparent)]"
              }`}
              aria-hidden="true"
            />
            <h2 className="truncate text-sm font-semibold  text-[var(--text-primary)]">
              {server.name}
            </h2>
          </div>
          <p className="mt-1.5 break-all font-mono text-xs text-[var(--text-muted)]" title={`${server.username}@${server.host}:${server.port}`}>
            {server.username}@{server.host}:{server.port}
          </p>
        </div>
        <span
          role="status"
          aria-label={t("serverOverviewCard.realtimeStatusAria", { status: listHealthLabel })}
          title={listHealthDescription}
          className={`max-w-full rounded-md border px-2 py-1 text-xs font-medium ${listHealthToneClass}`}
        >
          {diagnosticRun.status === "loading" ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 animate-ping rounded-full bg-current" aria-hidden="true" />
              {listHealthLabel}
            </span>
          ) : (
            listHealthLabel
          )}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs text-[var(--text-muted)]">
        <CompactField label={t("serverOverviewCard.connection")} value={server.connectionTypeLabel} />
        <CompactField
          label={t("serversPage.management.title")}
          value={server.managementMode === "AGENT"
            ? `${t("serversPage.management.agent")} · ${server.agent?.online ? t("serversPage.management.online") : server.hasSshCredential === false ? t("serversPage.management.agentOnly") : t("serversPage.management.fallback")}`
            : t("serversPage.management.direct")}
        />
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
      <p className="mt-4 flex-1 break-words text-xs leading-5 text-[var(--text-muted)]">
        {listHealthDescription}
      </p>

      <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--border-subtle)] pt-3">
        {server.enabled && canUseSshTerminal && server.hasSshCredential !== false ? (
          <ServerCardActions
            serverId={server.id}
            serverName={server.name}
            host={server.host}
            port={server.port}
            username={server.username}
            connectionType={server.connectionType as "SSH_KEY" | "PASSWORD"}
            managementMode={server.managementMode}
            hasSshCredential={server.hasSshCredential}
            description={server.description ?? null}
            tags={server.tags ?? []}
            enabled={server.enabled}
            canManageServers={false}
            canUseSshTerminal={canUseSshTerminal}
          />
        ) : null}
        <ActionButton variant="secondary"
          onClick={() => (expanded ? closeDialog() : openDialog())}
          aria-expanded={expanded}
          aria-controls={detailsId}
          aria-haspopup="dialog"
         
          className="!px-3 !py-1.5 !text-sm"
        >
          {expanded ? t("serverOverviewCard.collapseDetails") : t("serverOverviewCard.viewDetails")}
        </ActionButton>
      </div>
      </div>

      {portalReady && expanded
        ? createPortal(
            <ModalShell
              open={expanded}
              onClose={closeDialog}
              labelledBy={`${detailsId}-title`}
              overlayClassName="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-[var(--overlay-strong)] px-3 py-6 backdrop-blur-md sm:px-6"
              panelClassName="w-full max-w-5xl rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 text-[var(--text-primary)] shadow-2xl sm:p-5"
              panelProps={{ "data-server-details-modal": server.id }}
            >
                <div className="mb-3 flex items-center justify-between gap-3 border-b border-[var(--border)] pb-3">
                  <div className="min-w-0">
                    <p className="text-xs uppercase  text-[var(--text-muted)]">{t("serverOverviewCard.eyebrow")}</p>
                    <h3 id={`${detailsId}-title`} className="truncate text-base font-semibold text-[var(--text-primary)]">
                      {server.name}
                    </h3>
                  </div>
                  <ActionButton variant="secondary"
                    onClick={closeDialog}
                   
                    className="shrink-0 !px-3 !py-1.5 !text-sm"
                  >
                    {t("serverOverviewCard.collapseDetails")}
                  </ActionButton>
                </div>
                <div className="max-h-[78vh] overflow-y-auto pr-1">
                  <ServerOverviewDetails
                    server={server}
                    canManageServers={canManageServers}
                    canUseSshTerminal={canUseSshTerminal}
                    directLabel={directLabel}
                    detailsId={detailsId}
                    diagnosticRun={diagnosticRun}
                    onRunRealtimeDiagnostics={runRealtimeDiagnostics}
                  />
                </div>
            </ModalShell>,
            document.body,
          )
        : null}
    </article>
  );
}

function CompactField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 break-words text-xs font-medium text-[var(--text-secondary)]">{value}</div>
    </div>
  );
}
