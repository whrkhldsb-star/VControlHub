"use client";

import Link from "next/link";

import { ActionButton } from "@/components/action-button";
import { Server } from "@/components/icons";
import { Notice } from "@/components/ui-primitives";
import { useI18n } from "@/lib/i18n/use-locale";
import { ServerCardActions } from "./server-card-actions";
import type { ServerOverviewDetailsProps, ServerOverviewDetailsServer } from "./server-overview-details";
import { WindowsAgentInstallPanel } from "./windows-agent-install-panel";

type DiagnosticRun = ServerOverviewDetailsProps["diagnosticRun"];

export function WindowsServerDetails({
	server,
	canManageServers,
	canUseSshTerminal,
	detailsId,
	diagnosticRun,
	onRunRealtimeDiagnostics,
}: {
	server: ServerOverviewDetailsServer;
	canManageServers: boolean;
	canUseSshTerminal: boolean;
	detailsId: string;
	diagnosticRun: DiagnosticRun;
	onRunRealtimeDiagnostics: () => void;
}) {
	const { t } = useI18n();
	const agentMode = server.managementMode === "AGENT";
	const probeAvailable = agentMode && server.enabled;
	const certificate = server.rdpCertificateSha256
		? t("serversPage.windows.certificatePinned")
		: server.rdpIgnoreCertificate
			? t("serversPage.windows.certificateIgnored")
			: t("serversPage.windows.certificateDefault");

	return (
		<div id={detailsId} role="region" aria-label={`${server.name} ${t("serverOverviewDetails.vpsDetails")}`} className="space-y-3">
			<section className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-3">
				<h3 className="mb-3 text-sm font-medium text-[var(--text-primary)]">{t("serverOverviewDetails.section.connectionStatus")}</h3>
				<dl className="grid gap-3 text-sm sm:grid-cols-2">
					<DetailField label={t("serversPage.windows.os")} value="Windows" />
					<DetailField label={t("serverOverviewDetails.address")} value={`${server.host}:${server.port}`} />
					<DetailField label={t("serversPage.windows.username")} value={server.username} />
					<DetailField label={t("serversPage.management.title")} value={t(agentMode ? "serversPage.management.agent" : "serversPage.management.directWindows")} />
					<DetailField label={t("serversPage.windows.domain")} value={server.rdpDomain || t("serverOverviewCard.notConfigured")} />
					<DetailField label={t("serversPage.windows.certificate")} value={certificate} />
				</dl>
				{(server.tags ?? []).length > 0 ? (
					<div className="mt-3 flex flex-wrap gap-1.5">
						{server.tags?.map((tag) => <span key={tag} className="rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-0.5 text-xs text-[var(--text-muted)]">#{tag}</span>)}
					</div>
				) : null}
			</section>

			<section className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-3">
				<h3 className="mb-3 text-sm font-medium text-[var(--text-primary)]">{t("serverOverviewDetails.section.operationsResources")}</h3>
				<p className="text-xs leading-5 text-[var(--text-muted)]">{t(agentMode ? "serversPage.windows.agentCapabilities" : "serversPage.windows.capabilities")}</p>
				{server.storageNode ? <Link href={`/files?nodeId=${encodeURIComponent(server.storageNode.id)}`} className="mt-3 inline-flex rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--surface-elevated)]">
					{t("serversPage.windows.openCloudStorage")} · {server.storageNode.basePath}
				</Link> : null}
				{agentMode ? (
					<WindowsAgentInstallPanel
						serverId={server.id}
						agentOnline={Boolean(server.agent?.online)}
						agentLastError={server.agent?.lastError ?? null}
						canManageServers={canManageServers}
					/>
				) : null}
				<div className="mt-3 flex flex-wrap gap-2">
					{server.enabled && canUseSshTerminal ? (
						<Link href={`/servers/${encodeURIComponent(server.id)}/remote-desktop`} data-action-button data-variant="ghost" data-tone="cyan" className="w-full">
							<Server size={16} aria-hidden="true" />
							{t("serversPage.windows.remoteDesktop")}
						</Link>
					) : null}
					{probeAvailable ? (
						<ActionButton variant="success" onClick={onRunRealtimeDiagnostics} disabled={diagnosticRun.status === "loading"}>
							{diagnosticRun.status === "loading" ? t("serverOverviewDetails.diagnosing") : t("serverOverviewDetails.runRealtimeDiagnostics")}
						</ActionButton>
					) : null}
				</div>
				{diagnosticRun.status === "success" ? <p role="status" className="mt-3 text-xs text-[var(--success)]">{t("serverOverviewDetails.diagnosticSuccess", { summary: diagnosticRun.summary, checkedAt: diagnosticRun.checkedAt })}</p> : null}
				{diagnosticRun.status === "error" ? <Notice tone="danger" compact className="mt-3">{t("serverOverviewDetails.diagnosticFailure", { message: diagnosticRun.message, checkedAt: diagnosticRun.checkedAt })}</Notice> : null}
				{canManageServers ? (
					<div className="mt-4 border-t border-[var(--border)] pt-4">
						<ServerCardActions
							operatingSystem="WINDOWS"
							serverId={server.id}
							serverName={server.name}
							host={server.host}
							port={server.port}
							username={server.username}
							enabled={server.enabled}
							description={server.description}
							tags={server.tags}
							rdpCertificateSha256={server.rdpCertificateSha256}
							rdpDomain={server.rdpDomain}
							rdpIgnoreCertificate={server.rdpIgnoreCertificate}
							managementMode={server.managementMode}
							canManageServers={canManageServers}
							canUseSshTerminal={false}
							costAutoSync={server.costAutoSync}
							costMonthlyAmount={server.costMonthlyAmount}
							costCurrency={server.costCurrency}
							costProvider={server.costProvider}
							costLastSyncedAt={server.costLastSyncedAt}
							storagePath={server.storageNode?.basePath ?? null}
							storageNodeId={server.storageNode?.id ?? null}
							windowsSftpPort={server.storageNode?.port ?? 22}
							windowsSftpUsername={server.storageNode?.username ?? ""}
							directGateway={server.directGateway ?? undefined}
						/>
					</div>
				) : null}
			</section>
		</div>
	);
}

function DetailField({ label, value }: { label: string; value: string }) {
	return <div className="min-w-0"><dt className="text-xs text-[var(--text-muted)]">{label}</dt><dd className="mt-1 break-words font-medium text-[var(--text-secondary)]">{value}</dd></div>;
}
