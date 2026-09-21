"use client";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/use-locale";
import { ServerCardActions } from "./server-card-actions";
import type { ServerOverviewDetailsServer } from "./server-overview-details";

export function WindowsServerCard({ server, canManageServers, canUseSshTerminal }: {
  server: ServerOverviewDetailsServer; canManageServers: boolean; canUseSshTerminal: boolean;
}) {
  const { t } = useI18n();
  const certificate = server.rdpCertificateSha256 ? t("serversPage.windows.certificatePinned")
    : server.rdpIgnoreCertificate ? t("serversPage.windows.certificateIgnored")
    : t("serversPage.windows.certificateDefault");
  return <article data-card data-server-card className="group relative overflow-hidden !p-0 transition-colors">
    <div className="flex h-full flex-col p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-[var(--surface)] ${
                server.enabled
                  ? "bg-[var(--warning)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--warning)_20%,transparent)]"
                  : "bg-[var(--text-disabled)]"
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
            server.enabled
              ? "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)]"
              : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]"
          }`}
        >
          {t(server.enabled ? "serversPage.windows.ready" : "serverOverviewCard.disabled")}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs text-[var(--text-muted)]">
        <CompactField label={t("serversPage.windows.os")} value="Windows" />
        <CompactField label={t("serversPage.windows.port")} value={String(server.port)} />
        <CompactField label={t("serversPage.windows.domain")} value={server.rdpDomain || t("serverOverviewCard.notConfigured")} />
        <CompactField label={t("serversPage.windows.certificate")} value={certificate} />
      </div>
      <p className="mt-4 flex-1 break-words text-xs leading-5 text-[var(--text-muted)]">{t("serversPage.windows.capabilities")}</p>

      <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--border-subtle)] pt-3">
        {server.enabled && canUseSshTerminal && (
          <Link href={`/servers/${encodeURIComponent(server.id)}/remote-desktop`} data-action-button data-variant="secondary" className="!px-3 !py-1.5 !text-sm">
            {t("serversPage.windows.remoteDesktop")}
          </Link>
        )}
        <ServerCardActions operatingSystem="WINDOWS" serverId={server.id} serverName={server.name} host={server.host} port={server.port} username={server.username} enabled={server.enabled} description={server.description} tags={server.tags} rdpCertificateSha256={server.rdpCertificateSha256} rdpDomain={server.rdpDomain} rdpIgnoreCertificate={server.rdpIgnoreCertificate} canManageServers={canManageServers} canUseSshTerminal={false} />
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
