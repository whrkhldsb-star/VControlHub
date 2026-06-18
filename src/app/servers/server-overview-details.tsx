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
import type { ReactNode } from "react";

import { useI18n } from "@/lib/i18n/use-locale";
import { ServerCardActions } from "./server-card-actions";
import { getDirectGatewayRepairAdvice, getDirectGatewayHealthyNote } from "./direct-gateway-advice";

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

function InfoRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-baseline gap-3">
			<span className="w-[88px] shrink-0 text-xs text-slate-500">{label}</span>
			<span className="truncate text-sm text-white">{value}</span>
		</div>
	);
}

function statusToneClass(tone: "success" | "warning" | "info") {
	if (tone === "success") {
		return "border-emerald-400/25 bg-emerald-400/10 text-emerald-200 light:border-emerald-700/20 light:bg-emerald-50";
	}
	if (tone === "warning") {
		return "border-amber-400/25 bg-amber-400/10 text-amber-200 light:border-amber-700/20 light:bg-amber-50";
	}
	return "border-sky-400/25 bg-sky-400/10 text-sky-200 light:border-sky-700/20 light:bg-sky-50";
}

// TR-002 R3: advice 项的 tone 决定背景与边框；emerald=safe / amber=warning / rose=danger
function adviceToneClass(tone: "emerald" | "amber" | "rose" | undefined) {
	if (tone === "emerald") {
		return "border-emerald-400/20 bg-emerald-400/[0.05] light:border-emerald-700/20 light:bg-emerald-50/60";
	}
	if (tone === "rose") {
		return "border-rose-400/20 bg-rose-400/[0.05] light:border-rose-700/20 light:bg-rose-50/60";
	}
	// amber (default) 与原版一致
	return "border-amber-400/15 light:border-amber-700/20 light:bg-amber-50/60";
}

function adviceTitleClass(tone: "emerald" | "amber" | "rose" | undefined) {
	if (tone === "emerald") {
		return "text-emerald-100 light:text-emerald-900";
	}
	if (tone === "rose") {
		return "text-rose-100 light:text-rose-900";
	}
	return "text-amber-100 light:text-amber-900";
}

function adviceBadgeClass(tone: "emerald" | "amber" | "rose" | undefined) {
	if (tone === "emerald") {
		return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200 light:border-emerald-700/25 light:text-emerald-800";
	}
	if (tone === "rose") {
		return "border-rose-300/30 bg-rose-300/10 text-rose-200 light:border-rose-700/25 light:text-rose-800";
	}
	return "border-amber-300/30 bg-amber-300/10 text-amber-200 light:border-amber-700/25 light:text-amber-800";
}

function DirectGatewayHealthyDetail({
	statusLabel: dgLabel,
	publicUrl,
}: {
	statusLabel: string;
	publicUrl: string | null;
}) {
	return (
		<p data-testid="direct-gateway-healthy-note">
			{getDirectGatewayHealthyNote({ statusLabel: dgLabel, publicUrl })}
		</p>
	);
}

function DirectGatewayAdviceList({
	t,
	advice,
}: {
	t: (k: string) => string;
	advice: Array<{
		title: string;
		detail: string;
		priority: "primary" | "secondary";
		href: string | null;
		hrefLabel?: string;
		// TR-002 R3: 风险等级 tone，决定色彩。undefined = 沿用 amber 默认
		tone?: "emerald" | "amber" | "rose";
	}>;
}) {
	if (advice.length === 0) return null;
	return (
		<ul
			role="list"
			aria-label={t("serverOverviewDetails.directGatewayRepairAdvice")}
			className="mt-1 space-y-1.5"
		>
			{advice.map((item, index) => (
				<li
					key={`${item.title}-${index}`}
					data-tone={item.tone ?? "amber"}
					className={`rounded-md border px-2 py-1.5 ${adviceToneClass(item.tone)}`}
				>
					<div className={`flex flex-wrap items-baseline gap-1.5 text-[11px] font-medium leading-5 ${adviceTitleClass(item.tone)}`}>
						<span
							data-priority={item.priority}
							className={
								item.priority === "primary"
									? `rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${adviceBadgeClass(item.tone)}`
									: "rounded border border-slate-300/20 bg-slate-300/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-200 light:border-slate-400/30"
							}
						>
							{item.priority === "primary" ? t("serverOverviewDetails.recommendation") : t("serverOverviewDetails.reference")}
						</span>
						<span>{item.title}</span>
						{item.href && item.hrefLabel ? (
							<Link
								href={item.href}
								className="ml-auto text-cyan-200 underline-offset-4 hover:underline light:text-cyan-700"
								aria-label={item.hrefLabel}
							>
								{item.hrefLabel}
							</Link>
						) : null}
					</div>
					<p className="mt-1 text-[11px] leading-5 text-slate-400">
						{item.detail}
					</p>
				</li>
			))}
		</ul>
	);
}

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
	const directGatewayAdvice = getDirectGatewayRepairAdvice({
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
			className="mt-4 space-y-3 border-t border-white/[0.06] pt-4"
		>
			<section className="rounded-lg border border-white/[0.04] bg-slate-950/40 p-3">
				<h3 className="mb-3 text-sm font-medium text-white/80">连接与状态</h3>
				<div className="grid gap-2 text-sm">
					<InfoRow label={t("serverOverviewDetails.connectionType")} value={server.connectionTypeLabel} />
					<InfoRow label={t("serverOverviewDetails.username")} value={server.username} />
					<InfoRow label={t("serverOverviewDetails.address")} value={`${server.host}:${server.port}`} />
					<InfoRow label={t("serverOverviewDetails.nodeStatus")} value={server.statusLabel} />
					<InfoRow
						label="SSH 密钥"
						value={server.sshKey ? server.sshKey.name : t("serverOverviewDetails.notConfigured")}
					/>
				</div>
				<p
					data-tone="cyan"
					className="mt-3 rounded-lg border border-cyan-400/10 p-2 text-[11px] leading-5 text-slate-500 light:border-cyan-700/15 light:bg-cyan-50"
				>
					状态徽章表示 VControlHub 是否允许该 VPS 接收操作；若 SSH
					终端、文件中转或直连访问异常，请结合下方连接摘要、直连模式和最近命令状态定位真实服务健康。
				</p>
				{server.sshKey?.fingerprint ? (
					<p className="mt-2 truncate text-[11px] text-slate-600">
						指纹：{server.sshKey.fingerprint}
					</p>
				) : null}
				{(server.tags ?? []).length > 0 ? (
					<div className="mt-3 flex flex-wrap gap-1.5">
						{(server.tags ?? []).map((tag) => (
							<span
								key={tag}
								className="rounded-md border border-white/[0.06] bg-white/[0.04] px-2 py-0.5 text-[11px] text-slate-400"
							>
								#{tag}
							</span>
						))}
					</div>
				) : null}
			</section>

			<section className="rounded-lg border border-white/[0.04] bg-slate-950/40 p-3">
				<h3 className="mb-3 text-sm font-medium text-white/80">操作与资源</h3>
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
				</div>
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
							directGateway={server.directGateway ?? undefined}
						/>
					</div>
				) : null}
			</section>

			<section className="rounded-lg border border-cyan-400/10 bg-cyan-400/[0.035] p-3 light:border-cyan-700/15 light:bg-cyan-50">
				<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
					<div>
						<h3 className="text-sm font-medium text-cyan-100">诊断下一步</h3>
						<p className="mt-1 text-[11px] leading-5 text-slate-400">
							这里展示的是可执行诊断入口：节点“启用”只表示允许接收操作，不等于 SSH、SFTP 或 Direct
							Gateway 实时在线。
						</p>
					</div>
					<Link
						href={`/api/servers/monitor?serverId=${encodeURIComponent(server.id)}`}
						className="inline-flex shrink-0 items-center justify-center rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-3 py-1.5 text-xs text-cyan-100 transition hover:bg-cyan-300/15 light:border-cyan-700/20"
					>
						查看实时监控 JSON
					</Link>
				</div>
				<div className="mt-3 rounded-lg border border-white/[0.05] bg-slate-950/35 p-3">
					<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
						<div>
							<div className="text-xs font-medium text-white">实时探测</div>
							<p className="mt-1 text-[11px] leading-5 text-slate-500">
								点击后通过现有监控接口发起一次 SSH 只读采样，失败时会显示连接、权限或远端命令错误。
							</p>
						</div>
						<button
							type="button"
							onClick={onRunRealtimeDiagnostics}
							disabled={diagnosticRun.status === "loading" || !server.enabled}
							className="inline-flex shrink-0 items-center justify-center rounded-lg border border-emerald-300/25 bg-emerald-300/10 px-3 py-1.5 text-xs text-emerald-100 transition hover:bg-emerald-300/15 disabled:cursor-not-allowed disabled:opacity-60 light:border-emerald-700/20 light:bg-emerald-50"
						>
							{diagnosticRun.status === "loading" ? t("serverOverviewDetails.diagnosing") : t("serverOverviewDetails.runRealtimeDiagnostics")}
						</button>
					</div>
					{diagnosticRun.status === "success" ? (
						<div
							role="status"
							data-tone="emerald"
							className="mt-3 rounded-lg border border-emerald-400/20 p-2 text-[11px] leading-5 text-emerald-100 light:border-emerald-700/20 light:bg-emerald-50"
						>
							探测成功：{diagnosticRun.summary}（{diagnosticRun.checkedAt}）
						</div>
					) : null}
					{diagnosticRun.status === "error" ? (
						<div
							role="alert"
							data-tone="rose"
							className="mt-3 rounded-lg border border-rose-400/20 p-2 text-[11px] leading-5 text-rose-100 light:border-rose-700/20 light:bg-rose-50"
						>
							探测失败：{diagnosticRun.message}（{diagnosticRun.checkedAt}）
						</div>
					) : null}
				</div>
				<div className="mt-3 grid gap-2 sm:grid-cols-2">
					{diagnosticItems.map((item) => (
						<div
							key={item.label}
							className="rounded-lg border border-white/[0.05] bg-slate-950/35 p-3"
						>
							<div className="flex items-center justify-between gap-2">
								<span className="text-xs font-medium text-white">{item.label}</span>
								<span
									className={`rounded-full border px-2 py-0.5 text-[10px] ${statusToneClass(item.tone)}`}
								>
									{item.status}
								</span>
							</div>
							<div className="mt-2 text-[11px] leading-5 text-slate-500">
								{item.detail}
							</div>
							{item.href ? (
								<Link
									href={item.href}
									className="mt-2 inline-flex text-[11px] font-medium text-cyan-200 underline-offset-4 hover:underline"
								>
									打开相关入口
								</Link>
							) : null}
						</div>
					))}
				</div>
			</section>

			<section className="rounded-lg border border-white/[0.04] bg-slate-950/40 p-3">
				<h3 className="mb-3 text-sm font-medium text-white/80">最近命令投递</h3>
				{server.latestCommands.length === 0 ? (
					<p className="text-xs text-slate-500">暂无命令投递记录。</p>
				) : (
					<div className="space-y-2">
						{server.latestCommands.map((command) => (
							<div
								key={command.id}
								className="rounded-lg border border-white/[0.04] bg-white/[0.02] p-3"
							>
								<div className="flex items-center justify-between gap-2">
									<span className="truncate text-sm font-medium text-white">
										{command.title}
									</span>
									<span className="shrink-0 text-[11px] text-slate-500">
										{command.initiatedByType === "ASSISTANT" ? t("serverOverviewDetails.assistant") : t("serverOverviewDetails.user")}
									</span>
								</div>
								<div className="mt-1 text-[11px] text-slate-500">
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
