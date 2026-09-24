"use client";
import Link from "next/link";
import { ActionButton } from "@/components/action-button";
import { useI18n } from "@/lib/i18n/use-locale";
import { ServerCardActions } from "./server-card-actions";
import { WindowsAgentInstallPanel } from "./windows-agent-install-panel";
import type { ServerOverviewDetailsServer } from "./server-overview-details";

type DiagnosticRun = {
  status: "idle" | "loading" | "success" | "error";
  message?: string;
  checkedAt?: string;
};

export function WindowsServerCard({ server, canManageServers, canUseSshTerminal, diagnosticRun, onRunDiagnostics }: {
  server: ServerOverviewDetailsServer; canManageServers: boolean; canUseSshTerminal: boolean;
  diagnosticRun: DiagnosticRun; onRunDiagnostics: () => void;
}) {
  const { t } = useI18n();
  const certificate = server.rdpCertificateSha256 ? t("serversPage.windows.certificatePinned")
    : server.rdpIgnoreCertificate ? t("serversPage.windows.certificateIgnored")
    : t("serversPage.windows.certificateDefault");
  const agentMode = server.managementMode === "AGENT";
  const agentOnline = agentMode && Boolean(server.agent?.online);
  const probeAvailable = agentMode && server.enabled;
  const probeToneClass = diagnosticRun.status === "success"
    ? "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]"
    : diagnosticRun.status === "error"
      ? "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger)]"
      : diagnosticRun.status === "loading"
        ? "border-[var(--info-border)] bg-[var(--info-bg)] text-[var(--info)]"
        : "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)]";
  const probeLabel = !probeAvailable
    ? t("serversPage.windows.ready")
    : diagnosticRun.status === "success"
      ? t("serverOverviewCard.online")
      : diagnosticRun.status === "error"
        ? t("serverOverviewCard.offline")
        : diagnosticRun.status === "loading"
          ? t("serverOverviewCard.checking")
          : agentOnline
            ? t("serversPage.windows.agentConnected")
            : t("serversPage.windows.ready");
  return <article data-card data-server-card className="group relative overflow-hidden !p-0 transition-colors">
    <div className="flex h-full flex-col p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-[var(--surface)] ${
                !server.enabled
                  ? "bg-[var(--text-disabled)]"
                  : probeAvailable && diagnosticRun.status === "success"
                    ? "bg-[var(--success)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--success)_20%,transparent)]"
                    : probeAvailable && diagnosticRun.status === "error"
                      ? "bg-[var(--danger)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--danger)_20%,transparent)]"
                      : "bg-[var(--warning)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--warning)_20%,transparent)]"
              }`}
              aria-hidden="true"
            />
            <h2 className="truncate text-sm font-semibold text-[var(--text-primary)]">{server.name}</h2>
          </div>
          <p className="mt-1.5 break-all font-mono text-xs text-[var(--text-muted)]" title={`${server.username}@${server.host}:${server.port}`}>
            {server.username}@{server.host}:{server.port}
          </p>
        </div>
        <span
          role="status"
          title={t("serversPage.windows.hint")}
          className={`max-w-full rounded-md border px-2 py-1 text-xs font-medium ${
            !server.enabled
              ? "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]"
              : probeToneClass
          }`}
        >
          {probeLabel}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs text-[var(--text-muted)]">
        <CompactField label={t("serversPage.windows.os")} value="Windows" />
        <CompactField label={t("serversPage.windows.port")} value={String(server.port)} />
        <CompactField label={t("serversPage.windows.domain")} value={server.rdpDomain || t("serverOverviewCard.notConfigured")} />
        <CompactField label={t("serversPage.windows.certificate")} value={certificate} />
      </div>
      <p className="mt-4 flex-1 break-words text-xs leading-5 text-[var(--text-muted)]">
        {t(agentMode ? "serversPage.windows.agentCapabilities" : "serversPage.windows.capabilities")}
      </p>

      {agentMode ? (
        <WindowsAgentInstallPanel
          serverId={server.id}
          agentOnline={agentOnline}
          agentLastError={server.agent?.lastError ?? null}
          canManageServers={canManageServers}
        />
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--border-subtle)] pt-3">
        {probeAvailable ? (
          <ActionButton
            variant="secondary"
            onClick={onRunDiagnostics}
            disabled={diagnosticRun.status === "loading"}
            className="!px-3 !py-1.5 !text-sm"
          >
            {diagnosticRun.status === "loading" ? t("serverOverviewDetails.diagnosing") : t("serverOverviewDetails.runRealtimeDiagnostics")}
          </ActionButton>
        ) : null}
        {server.enabled && canUseSshTerminal && (
          <Link href={`/servers/${encodeURIComponent(server.id)}/remote-desktop`} data-action-button data-variant="secondary" className="!px-3 !py-1.5 !text-sm">
            {t("serversPage.windows.remoteDesktop")}
          </Link>
        )}
        <ServerCardActions operatingSystem="WINDOWS" serverId={server.id} serverName={server.name} host={server.host} port={server.port} username={server.username} enabled={server.enabled} description={server.description} tags={server.tags} rdpCertificateSha256={server.rdpCertificateSha256} rdpDomain={server.rdpDomain} rdpIgnoreCertificate={server.rdpIgnoreCertificate} managementMode={server.managementMode} canManageServers={canManageServers} canUseSshTerminal={false}
          costAutoSync={server.costAutoSync} costMonthlyAmount={server.costMonthlyAmount} costCurrency={server.costCurrency} costProvider={server.costProvider} costLastSyncedAt={server.costLastSyncedAt} />
      </div>
    </div>
  </article>;
}

function CompactField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 break-words text-xs font-medium text-[var(--text-secondary)]">{value}</div>
    </div>
  );
}
