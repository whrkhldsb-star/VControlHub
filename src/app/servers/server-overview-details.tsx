/**
 * Real `ServerOverviewDetails` component.
 *
 * TR-036: The expanded "查看详情" panel (connection & status,
 * operations & resources, diagnostic items, latest commands) only
 * renders when the user clicks the toggle. Routing it through
 * `next/dynamic` defers that chunk's `ServerCardActions` import
 * graph (and its server-action / form wiring) until that
 * interaction. The stub preserves the panel's outer footprint so
 * the parent card doesn't visibly shift when the chunk arrives.
 *
 * `ssr: false` is correct: the panel is a pure client-side
 * interaction surface with no value in pre-rendering. Stub
 * preserves vertical space so a slow chunk doesn't make the
 * collapsed card look broken.
 */
"use client";

import Link from "next/link";
import { type ReactNode } from "react";

import { useI18n } from "@/lib/i18n/use-locale";
import { ServerCardActions } from "./server-card-actions";
import { VpsBackupSection } from "./vps-backup-section";
import { getDirectGatewayRepairAdvice } from "./direct-gateway-advice";
import { DirectGatewayAdviceList, DirectGatewayHealthyDetail, InfoRow, OsDialectSection } from "./server-overview-detail-sections";
import { ActionButton, ButtonLink } from "@/components/action-button";
import { StatusBadge } from "@/components/status-badge";
import { Badge, Notice } from "@/components/ui-primitives";
import { serverConnectionLabel, serverConnectionSummary, serverEnabledLabel } from "./server-labels";

export type ServerOverviewDetailsServer = {
	operatingSystem?: string;
	rdpDomain?: string;
	rdpIgnoreCertificate?: boolean;
	rdpCertificateSha256?: string;
	id: string;
	name: string;
	host: string;
	port: number;
	username: string;
	description?: string | null;
	tags?: string[] | null;
	enabled: boolean;
	connectionType: "SSH_KEY" | "PASSWORD";
	managementMode: "DIRECT" | "AGENT";
	hasSshCredential?: boolean;
	agent?: { online: boolean; lastSeenAt: string | null; metricsAt: string | null; version: string | null; capabilities: string[]; lastError: string | null };
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
	storageNode?: { id: string; name: string; basePath: string; host?: string | null; port?: number | null; username?: string | null } | null;
	directGateway?: {
		enabled: boolean;
		publicUrl: string | null;
		port: number;
		// TR-002 R3: 节点监听地址 + 解析的传输协议，UI 用作 risk banner 输入
		bindAddress?: string | null;
		publicProtocol?: "http" | "https" | "unknown" | null;
	} | null;
	// TR-041: OS dialect + info for display and dialect-aware operations
	osDialect?: string | null;
	osInfo?: string | null;
	// TR-031: monthly VPS cost auto-sync settings
	costAutoSync?: boolean;
	costMonthlyAmount?: string | null;
	costCurrency?: "CNY" | "USD" | "EUR" | "JPY" | "HKD";
	costProvider?: string | null;
	costLastSyncedAt?: string | null;
};

export type ServerOverviewDetailsProps = {
	server: ServerOverviewDetailsServer;
	canManageServers: boolean;
	canUseSshTerminal: boolean;
	directLabel: string;
	detailsId: string;
	diagnosticRun:
		| { status: "idle" }
		| { status: "loading" }
		| { status: "success"; summary: string; checkedAt: string }
		| { status: "error"; message: string; checkedAt: string };
	onRunRealtimeDiagnostics: () => void;
};

export function ServerOverviewDetails({
	server,
	canManageServers,
	canUseSshTerminal,
	directLabel,
	detailsId,
	diagnosticRun,
	onRunRealtimeDiagnostics,
}: ServerOverviewDetailsProps) {
	const { t } = useI18n();
	const directGatewayAdvice = getDirectGatewayRepairAdvice(t, {
		directGateway: server.directGateway ?? null,
		serverEnabled: server.enabled,
		hasStorageNode: !!server.storageNode,
		pendingCommandCount: server.pendingCommandCount,
		canManageServers,
	});
	const directGatewayHealthy = directGatewayAdvice.length === 0;
	const diagnosticItems: Array<{
		label: string;
		status: string;
		tone: "success" | "warning" | "info";
		detail: ReactNode;
		href: string | null;
	}> = [
		{
			label: t("serverOverviewDetails.sshInteractive"),
			status: server.enabled && canUseSshTerminal && server.hasSshCredential !== false
				? t("serverOverviewDetails.verifiable")
				: server.hasSshCredential === false
					? t("serversPage.management.agentOnly")
				: server.enabled
					? t("serverOverviewDetails.missingPermission")
					: t("serverOverviewDetails.nodeDisabled"),
			tone: server.enabled && canUseSshTerminal && server.hasSshCredential !== false ? "success" : "warning",
			detail: server.hasSshCredential === false
				? t("serversPage.management.agentOnlySshHint")
				: server.enabled
				? t("serverOverviewDetails.sshInteractiveDetail")
				: t("serverOverviewDetails.enableNodeFirst"),
			href: null,
		},
		{
			label: t("serverOverviewDetails.sftpManagement"),
			status: server.storageNode ? t("serverOverviewDetails.bound") : t("serverOverviewDetails.unbound"),
			tone: server.storageNode ? "success" : "warning",
			detail: server.storageNode
				? t("serverOverviewDetails.sftpDetailPrefix") + server.storageNode.name + " · " + server.storageNode.basePath + t("serverOverviewDetails.sftpDetailSuffix")
				: t("serverOverviewDetails.sftpUnboundDetail"),
			href: server.storageNode
				? `/files?nodeId=${encodeURIComponent(server.storageNode.id)}`
				: null,
		},
		{
			label: t("serverOverviewDetails.directGateway"),
			status: server.directGateway?.enabled ? t("serverOverviewDetails.configured") : t("serverOverviewDetails.websiteRelay"),
			tone: server.directGateway?.enabled ? "success" : "info",
			detail: directGatewayHealthy ? (
				<DirectGatewayHealthyDetail
					t={t}
					statusLabel={directLabel}
					publicUrl={server.directGateway?.publicUrl ?? null}
				/>
			) : (
				<DirectGatewayAdviceList t={t} advice={directGatewayAdvice} />
			),
			href: server.directGateway?.publicUrl ?? null,
		},
		{
			label: t("serverOverviewDetails.commandApprovalQueue"),
			status:
				server.pendingCommandCount > 0
					? server.pendingCommandCount + t("serverOverviewDetails.pendingCountSuffix")
					: t("serverOverviewDetails.noPending"),
			tone: server.pendingCommandCount > 0 ? "warning" : "success",
			detail:
				server.pendingCommandCount > 0
					? t("serverOverviewDetails.pendingDetail")
					: t("serverOverviewDetails.noPendingDetail"),
			href: server.pendingCommandCount > 0 ? "/requests" : null,
		},
	];

	return (
		<div
			id={detailsId}
			role="region"
			aria-label={`${server.name} ${t("serverOverviewDetails.vpsDetails")}`}
			className="space-y-3"
		>
			<section data-inset className="p-3">
				<h3 className="ui-title-group mb-3">{t("serverOverviewDetails.section.connectionStatus")}</h3>
				<div className="grid gap-2 text-sm">
					<InfoRow label={t("serverOverviewDetails.connectionType")} value={serverConnectionLabel(server, t)} />
					<InfoRow label={t("serverOverviewDetails.username")} value={server.username} />
					<InfoRow label={t("serverOverviewDetails.address")} value={`${server.host}:${server.port}`} />
					<InfoRow label={t("serverOverviewDetails.nodeStatus")} value={serverEnabledLabel(server.enabled, t)} />
					<InfoRow
						label={t("serverOverviewDetails.sshKey")}
						value={server.sshKey ? server.sshKey.name : t("serverOverviewDetails.notConfigured")}
					/>
				</div>
				<p
					data-tone="cyan"
					data-inset className="mt-3 p-2 text-xs leading-5 text-[var(--text-muted)]"
				>
					{t("serverOverviewDetails.banner.description")}
				</p>
				{server.sshKey?.fingerprint ? (
					<p className="mt-2 truncate text-xs text-[var(--text-muted)]">
						{t("serverOverviewDetails.fingerprintPrefix")}{server.sshKey.fingerprint}
					</p>
				) : null}
				{(server.tags ?? []).length > 0 ? (
					<div className="mt-3 flex flex-wrap gap-1.5">
						{(server.tags ?? []).map((tag) => (
							<Badge key={tag}>
								#{tag}
							</Badge>
						))}
					</div>
				) : null}
			</section>

			<section data-inset className="p-3">
				<h3 className="ui-title-group mb-3">{t("serverOverviewDetails.section.operationsResources")}</h3>
				<div className="space-y-2 text-sm">
					<InfoRow
						label={t("serverOverviewDetails.relatedStorage")}
						value={
							server.storageNode
								? `${server.storageNode.name} · ${server.storageNode.basePath}`
								: t("serverOverviewDetails.unbound")
						}
					/>
					<InfoRow label={t("serverOverviewDetails.directMode")} value={directLabel} />
					<InfoRow label={t("serverOverviewDetails.totalCommandTargets")} value={String(server.targetCount)} />
					<InfoRow label={t("serverOverviewDetails.connectionSummary")} value={serverConnectionSummary(server, t)} />
					<InfoRow
						label={t("serversPage.management.title")}
						value={server.managementMode === "AGENT"
							? `${t("serversPage.management.agent")} · ${server.agent?.online ? t("serversPage.management.online") : server.hasSshCredential === false ? t("serversPage.management.agentOnly") : t("serversPage.management.fallback")}`
							: t("serversPage.management.direct")}
					/>
					{server.managementMode === "AGENT" && server.agent?.lastError ? <InfoRow label={t("serversPage.management.lastError")} value={server.agent.lastError} /> : null}
					<OsDialectSection
						serverId={server.id}
						osDialect={server.osDialect}
						osInfo={server.osInfo}
					/>
					</div>
					{/* TR-043: VPS Remote Backup */}
					{canManageServers ? (
					<div className="mt-4">
						<div className="mb-2 text-xs font-semibold uppercase text-[var(--text-muted)]">
							{t("vpsBackup.sectionTitle")}
						</div>
						<VpsBackupSection
							serverId={server.id}
							canManage={canManageServers}
						/>
					</div>
					) : null}
				{canManageServers || canUseSshTerminal ? (
					<div className="mt-3">
						<ServerCardActions
							serverId={server.id}
							serverName={server.name}
							host={server.host}
							port={server.port}
							enabled={server.enabled}
							canManageServers={canManageServers}
							canUseSshTerminal={canUseSshTerminal && server.hasSshCredential !== false}
							username={server.username}
							connectionType={server.connectionType}
							managementMode={server.managementMode}
							hasSshCredential={server.hasSshCredential}
							description={server.description}
							tags={server.tags}
							costAutoSync={server.costAutoSync}
							costMonthlyAmount={server.costMonthlyAmount}
							costCurrency={server.costCurrency}
							costProvider={server.costProvider}
							costLastSyncedAt={server.costLastSyncedAt}
							storagePath={server.storageNode?.basePath ?? null}
							storageNodeId={server.storageNode?.id ?? null}
							directGateway={server.directGateway ?? undefined}
						/>
					</div>
				) : null}
			</section>

			<section data-inset className="p-3">
				<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
					<div>
						<h3 className="ui-title-group">{t("serverOverviewDetails.diagnosticsNext")}</h3>
						<p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
							{t("serverOverviewDetails.diagnosticsDescription")}
						</p>
					</div>
					<ButtonLink
						size="sm"
						variant="outline"
						href={`/api/servers/monitor?serverId=${encodeURIComponent(server.id)}`}
						className="shrink-0"
					>
						{t("serverOverviewDetails.viewMonitorJson")}
					</ButtonLink>
				</div>
				<div data-inset className="mt-3 p-3">
					<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
						<div>
							<div className="text-xs font-medium text-[var(--text-primary)]">{t("serverOverviewDetails.realtimeProbe")}</div>
							<p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
								{t("serverOverviewDetails.realtimeProbeDescription")}
							</p>
						</div>
						<ActionButton size="sm" variant="success"
							onClick={onRunRealtimeDiagnostics}
							disabled={diagnosticRun.status === "loading" || !server.enabled} className="inline-flex shrink-0 items-center justify-center">
							{diagnosticRun.status === "loading" ? t("serverOverviewDetails.diagnosing") : t("serverOverviewDetails.runRealtimeDiagnostics")}
						</ActionButton>
					</div>
					{diagnosticRun.status === "success" ? (
						<Notice tone="success" compact className="mt-3">
							{t("serverOverviewDetails.diagnosticSuccess", { summary: diagnosticRun.summary, checkedAt: diagnosticRun.checkedAt })}
						</Notice>
					) : null}
					{diagnosticRun.status === "error" ? (
						<Notice tone="danger" compact>
							{t("serverOverviewDetails.diagnosticFailure", { message: diagnosticRun.message, checkedAt: diagnosticRun.checkedAt })}
						</Notice>
					) : null}
				</div>
				<div className="mt-3 grid gap-2 sm:grid-cols-2">
					{diagnosticItems.map((item) => (
						<div
							key={item.label}
						 data-inset className="p-3"
						>
							<div className="flex items-center justify-between gap-2">
								<span className="text-xs font-medium text-[var(--text-primary)]">{item.label}</span>
								<StatusBadge tone={item.tone}>
									{item.status}
								</StatusBadge>
							</div>
							<div className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
								{item.detail}
							</div>
							{item.href ? (
								<Link
									href={item.href}
									className="mt-2 inline-flex text-xs font-medium text-[var(--text-secondary)] underline-offset-4 hover:underline"
								>
									{t("serverOverviewDetails.openRelatedEntry")}
								</Link>
							) : null}
						</div>
					))}
				</div>
			</section>

			<section data-inset className="p-3">
				<h3 className="ui-title-group mb-3">{t("serverOverviewDetails.latestCommands")}</h3>
				{server.latestCommands.length === 0 ? (
					<p className="text-xs text-[var(--text-muted)]">{t("serverOverviewDetails.noCommandRecords")}</p>
				) : (
					<div className="space-y-2">
						{server.latestCommands.map((command) => (
							<div
								key={command.id}
							 data-tile className="p-3"
							>
								<div className="flex items-center justify-between gap-2">
									<span className="truncate text-sm font-medium text-[var(--text-primary)]">
										{command.title}
									</span>
									<span className="shrink-0 text-xs text-[var(--text-muted)]">
										{command.initiatedByType === "ASSISTANT" ? t("serverOverviewDetails.assistant") : t("serverOverviewDetails.user")}
									</span>
								</div>
								<div className="mt-1 text-xs text-[var(--text-muted)]">
									{command.requestStatus} · {command.targetStatus}
								</div>
							</div>
						))}
					</div>
				)}
			</section>
		</div>
	);
}
