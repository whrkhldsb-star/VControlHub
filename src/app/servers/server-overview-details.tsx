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
import { DirectGatewayAdviceList, DirectGatewayHealthyDetail, InfoRow, OsDialectSection, statusToneClass } from "./server-overview-detail-sections";

export type ServerOverviewDetailsServer = {
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
	sessionToken: string;
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
	sessionToken,
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
			status: server.enabled && canUseSshTerminal
				? t("serverOverviewDetails.verifiable")
				: server.enabled
					? t("serverOverviewDetails.missingPermission")
					: t("serverOverviewDetails.nodeDisabled"),
			tone: server.enabled && canUseSshTerminal ? "success" : "warning",
			detail: server.enabled
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
					statusLabel={server.directGateway?.statusLabel ?? t("serverOverviewDetails.websiteRelay")}
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
			<section className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-3">
				<h3 className="mb-3 text-sm font-medium text-[var(--text-primary)]">{t("serverOverviewDetails.section.connectionStatus")}</h3>
				<div className="grid gap-2 text-sm">
					<InfoRow label={t("serverOverviewDetails.connectionType")} value={server.connectionTypeLabel} />
					<InfoRow label={t("serverOverviewDetails.username")} value={server.username} />
					<InfoRow label={t("serverOverviewDetails.address")} value={`${server.host}:${server.port}`} />
					<InfoRow label={t("serverOverviewDetails.nodeStatus")} value={server.statusLabel} />
					<InfoRow
						label={t("serverOverviewDetails.sshKey")}
						value={server.sshKey ? server.sshKey.name : t("serverOverviewDetails.notConfigured")}
					/>
				</div>
				<p
					data-tone="cyan"
					className="mt-3 rounded-lg border border-[var(--color-action-border)]/10 p-2 text-[11px] leading-5 text-[var(--text-muted)] light:border-[var(--color-action-border)]/15 light:bg-[var(--color-action-bg)]"
				>
					{t("serverOverviewDetails.banner.description")}
				</p>
				{server.sshKey?.fingerprint ? (
					<p className="mt-2 truncate text-[11px] text-[var(--text-muted)]">
						{t("serverOverviewDetails.fingerprintPrefix")}{server.sshKey.fingerprint}
					</p>
				) : null}
				{(server.tags ?? []).length > 0 ? (
					<div className="mt-3 flex flex-wrap gap-1.5">
						{(server.tags ?? []).map((tag) => (
							<span
								key={tag}
								className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]"
							>
								#{tag}
							</span>
						))}
					</div>
				) : null}
			</section>

			<section className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-3">
				<h3 className="mb-3 text-sm font-medium text-[var(--text-primary)]">{t("serverOverviewDetails.section.operationsResources")}</h3>
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
					<InfoRow label={t("serverOverviewDetails.connectionSummary")} value={server.connectionSummary} />
					<OsDialectSection
						serverId={server.id}
						osDialect={server.osDialect}
						osInfo={server.osInfo}
					/>
					</div>
					{/* TR-043: VPS Remote Backup */}
					{canManageServers ? (
					<div className="mt-4">
						<div className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
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
							sessionToken={sessionToken}
							canManageServers={canManageServers}
							canUseSshTerminal={canUseSshTerminal}
							username={server.username}
							connectionType={server.connectionType}
							description={server.description}
							tags={server.tags}
							costAutoSync={server.costAutoSync}
							costMonthlyAmount={server.costMonthlyAmount}
							costCurrency={server.costCurrency}
							costProvider={server.costProvider}
							costLastSyncedAt={server.costLastSyncedAt}
							directGateway={server.directGateway ?? undefined}
						/>
					</div>
				) : null}
			</section>

			<section className="rounded-lg border border-[var(--color-action-border)]/10 bg-[var(--color-action-bg)]/[0.035] p-3 light:border-[var(--color-action-border)]/15 light:bg-[var(--color-action-bg)]">
				<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
					<div>
						<h3 className="text-sm font-medium text-[var(--text-primary)]">{t("serverOverviewDetails.diagnosticsNext")}</h3>
						<p className="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">
							{t("serverOverviewDetails.diagnosticsDescription")}
						</p>
					</div>
					<Link
						href={`/api/servers/monitor?serverId=${encodeURIComponent(server.id)}`}
						className="inline-flex shrink-0 items-center justify-center rounded-lg border border-[var(--color-action-border)]/25 bg-[var(--color-action-bg)]/10 px-3 py-1.5 text-xs text-[var(--text-primary)] transition hover:bg-[var(--color-action-bg)]/15 light:border-[var(--color-action-border)]/20"
					>
						{t("serverOverviewDetails.viewMonitorJson")}
					</Link>
				</div>
				<div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-3">
					<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
						<div>
							<div className="text-xs font-medium text-[var(--text-primary)]">{t("serverOverviewDetails.realtimeProbe")}</div>
							<p className="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">
								{t("serverOverviewDetails.realtimeProbeDescription")}
							</p>
						</div>
						<button
							type="button"
							onClick={onRunRealtimeDiagnostics}
							disabled={diagnosticRun.status === "loading" || !server.enabled}
						 data-action-button data-variant="success" className="inline-flex shrink-0 items-center justify-center !px-3 !py-1.5 !text-xs disabled:cursor-not-allowed disabled:opacity-60">
							{diagnosticRun.status === "loading" ? t("serverOverviewDetails.diagnosing") : t("serverOverviewDetails.runRealtimeDiagnostics")}
						</button>
					</div>
					{diagnosticRun.status === "success" ? (
						<div
							role="status"
							data-tone="emerald"
							className="mt-3 rounded-lg border border-[var(--success-border)] p-2 text-[11px] leading-5 text-[var(--success)] light:border-[var(--success-border)]"
						>
							{t("serverOverviewDetails.diagnosticSuccess").replace("{summary}", diagnosticRun.summary).replace("{checkedAt}", diagnosticRun.checkedAt)}
						</div>
					) : null}
					{diagnosticRun.status === "error" ? (
						<div
							role="alert"
							data-tone="rose"
							className="mt-3 rounded-lg border border-[var(--danger-border)] p-2 text-[11px] leading-5 text-[var(--danger)] light:border-[var(--danger-border)]"
						>
							{t("serverOverviewDetails.diagnosticFailure").replace("{message}", diagnosticRun.message).replace("{checkedAt}", diagnosticRun.checkedAt)}
						</div>
					) : null}
				</div>
				<div className="mt-3 grid gap-2 sm:grid-cols-2">
					{diagnosticItems.map((item) => (
						<div
							key={item.label}
							className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-3"
						>
							<div className="flex items-center justify-between gap-2">
								<span className="text-xs font-medium text-[var(--text-primary)]">{item.label}</span>
								<span
									className={`rounded-full border px-2 py-0.5 text-[10px] ${statusToneClass(item.tone)}`}
								>
									{item.status}
								</span>
							</div>
							<div className="mt-2 text-[11px] leading-5 text-[var(--text-muted)]">
								{item.detail}
							</div>
							{item.href ? (
								<Link
									href={item.href}
									className="mt-2 inline-flex text-[11px] font-medium text-[var(--text-secondary)] underline-offset-4 hover:underline"
								>
									{t("serverOverviewDetails.openRelatedEntry")}
								</Link>
							) : null}
						</div>
					))}
				</div>
			</section>

			<section className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-3">
				<h3 className="mb-3 text-sm font-medium text-[var(--text-primary)]">{t("serverOverviewDetails.latestCommands")}</h3>
				{server.latestCommands.length === 0 ? (
					<p className="text-xs text-[var(--text-muted)]">{t("serverOverviewDetails.noCommandRecords")}</p>
				) : (
					<div className="space-y-2">
						{server.latestCommands.map((command) => (
							<div
								key={command.id}
								className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-3"
							>
								<div className="flex items-center justify-between gap-2">
									<span className="truncate text-sm font-medium text-[var(--text-primary)]">
										{command.title}
									</span>
									<span className="shrink-0 text-[11px] text-[var(--text-muted)]">
										{command.initiatedByType === "ASSISTANT" ? t("serverOverviewDetails.assistant") : t("serverOverviewDetails.user")}
									</span>
								</div>
								<div className="mt-1 text-[11px] text-[var(--text-muted)]">
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
