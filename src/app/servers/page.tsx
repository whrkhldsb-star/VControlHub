import { cookies } from "next/headers";
import Link from "next/link";
import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listServerProfiles } from "@/lib/server/service";
import { PageShell, StatCard, EmptyState } from "@/components/page-shell";
import { getSessionCookieName } from "@/lib/auth/session";
import { logError } from "@/lib/logging";

import { getServerFormOptions } from "./actions";
import { BatchServerActionPanel } from "./batch-server-action-panel";
import { CommandCreateForm } from "./command-create-form";
import { ServerCardActions } from "./server-card-actions";
import { ServerCreateForm } from "./server-create-form";
import { SshKeyCreateForm } from "./ssh-key-create-form";
import { ServerTabLayout } from "./server-tab-layout";
import { ServerMonitorCard } from "./server-monitor-card";

export const dynamic = "force-dynamic";

export default async function ServersPage() {
	const session = await requireSession("/servers");
	const canManageServers = sessionHasPermission(session, "server:write");
	const canUseSshTerminal = sessionHasPermission(session, "server:ssh");
	const canCreateCommand = sessionHasPermission(session, "command:create");
	const cookieStore = await cookies();
	const sessionToken = cookieStore.get(getSessionCookieName())?.value ?? "";
	let servers, formOptions;
	try {
		[servers, formOptions] = await Promise.all([
			listServerProfiles(),
			canManageServers ? getServerFormOptions() : Promise.resolve({ sshKeys: [] }),
		]);
	} catch (e) {
		logError("[ServersPage] Data fetch error:", e);
		throw e;
	}

	const enabledCount = servers.filter((s) => s.enabled).length;
	const storageCount = servers.filter((s) => s.storageNode).length;
	const enabledServers = servers.filter((server) => server.enabled);

	return (
		<PageShell maxW="max-w-7xl">
			<header className="mb-8">
				<div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
					<div>
						<h1 className="text-3xl font-semibold tracking-tight text-white">VPS 管理</h1>
						<p className="mt-1.5 text-sm text-slate-500">
							通过 SSH 密钥 + IP + 端口纳管节点，支持命令分发、SFTP 存储绑定与审计追踪。
						</p>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<Link href="/audit" className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3.5 py-2 text-sm text-slate-200 transition hover:bg-white/[0.06]">
							查看审计日志
						</Link>
						<Link href="/deployments" className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3.5 py-2 text-sm text-slate-200 transition hover:bg-white/[0.06]">
							去部署面板
						</Link>
					</div>
				</div>
			</header>

			<section className="grid gap-3 sm:grid-cols-3 mb-8">
				<StatCard label="节点总数" value={String(servers.length)} />
				<StatCard label="启用节点" value={String(enabledCount)} accent={enabledCount > 0} />
				<StatCard label="已绑定存储" value={String(storageCount)} accent={storageCount > 0} />
			</section>

			{canManageServers && servers.length > 0 && (
				<BatchServerActionPanel servers={servers.map((server) => ({ id: server.id, name: server.name, enabled: server.enabled }))} enabledCount={enabledServers.length} />
			)}

			<ServerTabLayout
				nodesPanel={
					<div className="space-y-4">
						{canManageServers && (
							<div className="mb-6">
								<ServerCreateForm sshKeys={formOptions.sshKeys} />
							</div>
						)}
						{servers.length === 0 ? (
							<EmptyState text="暂无已纳管 VPS。点击上方表单录入 SSH 密钥、IP 与端口完成纳管。" />
						) : (
							servers.map((server) => (
								<article key={server.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 hover:bg-white/[0.04] transition-colors duration-150">
									<div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
										<div>
											<div className="flex flex-wrap items-center gap-2.5">
												<h2 className="text-lg font-semibold text-white">{server.name}</h2>
												<StatusBadge enabled={server.enabled} />
											</div>
											<p className="mt-1.5 text-sm text-slate-400">{server.connectionSummary}</p>
											{server.description && <p className="mt-0.5 text-xs text-slate-500">{server.description}</p>}
										</div>
										<div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5 text-sm">
											<div className="text-slate-300">待审批：<span className="font-medium text-white">{server.pendingCommandCount}</span></div>
											<div className="mt-0.5 text-xs text-slate-500">{server.connectionTypeLabel} · {server.statusLabel}</div>
										</div>
									</div>

									<div className="mt-4 grid gap-3 lg:grid-cols-2">
										<div className="space-y-3">
											<section className="rounded-lg border border-white/[0.04] bg-slate-950/40 p-4">
												<h3 className="text-sm font-medium text-white/80 mb-3">节点概览</h3>
												<div className="grid gap-2 text-sm">
													<InfoRow label="连接方式" value={server.connectionTypeLabel} />
													<InfoRow label="登录账号" value={server.username} />
													<InfoRow label="地址" value={`${server.host}:${server.port}`} />
												</div>
												{(server.tags ?? []).length > 0 && (
													<div className="mt-3 flex flex-wrap gap-1.5">
														{(server.tags ?? []).map((tag: string) => (
															<span key={tag} className="rounded-md bg-white/[0.04] border border-white/[0.06] px-2 py-0.5 text-[11px] text-slate-400">#{tag}</span>
														))}
													</div>
												)}
											</section>

											<section className="rounded-lg border border-white/[0.04] bg-slate-950/40 p-4">
												<h3 className="text-sm font-medium text-white/80 mb-3">最近命令投递</h3>
												{server.latestCommands.length === 0 ? (
													<p className="text-xs text-slate-500">暂无命令投递记录。</p>
												) : (
													<div className="space-y-2">
														{server.latestCommands.map((command: { id: string; title: string; initiatedByType: string; requestStatus: string; targetStatus: string }) => (
															<div key={command.id} className="rounded-lg border border-white/[0.04] bg-white/[0.02] p-3">
																<div className="flex items-center justify-between gap-2">
																	<span className="text-sm font-medium text-white truncate">{command.title}</span>
																	<span className="text-[11px] text-slate-500 shrink-0">{command.initiatedByType === "ASSISTANT" ? "助手" : "用户"}</span>
																</div>
																<div className="mt-1 text-[11px] text-slate-500">{command.requestStatus} · {command.targetStatus}</div>
															</div>
														))}
													</div>
												)}
											</section>
										</div>

										<div className="space-y-3">
											<section className="rounded-lg border border-white/[0.04] bg-slate-950/40 p-4">
												<h3 className="text-sm font-medium text-white/80 mb-3">节点操作</h3>
												<div className="space-y-2 text-sm">
													<InfoRow label="关联存储" value={server.storageNode ? `${server.storageNode.name} · ${server.storageNode.basePath}` : "未绑定"} />
													<InfoRow label="累计命令目标" value={String(server.targetCount)} />
													{(canManageServers || canUseSshTerminal) && <ServerCardActions serverId={server.id} serverName={server.name} host={server.host} port={server.port} enabled={server.enabled} sessionToken={sessionToken} canManageServers={canManageServers} canUseSshTerminal={canUseSshTerminal} />}
												</div>
											</section>

											<section className="rounded-lg border border-white/[0.04] bg-slate-950/40 p-4">
												<h3 className="text-sm font-medium text-white/80 mb-3">关联资源</h3>
												<div className="space-y-2 text-sm">
													<InfoRow label="SSH 密钥" value={server.sshKey ? server.sshKey.name : "未配置"} />
													{server.sshKey && <p className="text-[11px] text-slate-600 pl-[120px]">{server.sshKey.fingerprint}</p>}
													<InfoRow label="节点状态" value={server.statusLabel} />
													<InfoRow label="连接摘要" value={server.connectionSummary} />
												</div>
											</section>

											{server.enabled && (
												<ServerMonitorCard serverId={server.id} serverName={server.name} />
											)}
										</div>
									</div>
								</article>
							))
						)}
					</div>
				}
				sshKeysPanel={
					<div>
						{canManageServers ? <SshKeyCreateForm /> : <EmptyState text="当前角色无节点纳管权限。" />}
					</div>
				}
				commandsPanel={
					<div>
						{canCreateCommand ? (
							<CommandCreateForm servers={servers.map((server) => ({ id: server.id, name: server.name, host: server.host, enabled: server.enabled }))} />
						) : (
							<EmptyState text="当前角色无命令下发权限。" />
						)}
					</div>
				}
			/>
		</PageShell>
	);
}

function StatusBadge({ enabled }: { enabled: boolean }) {
	return (
		<span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
			enabled
				? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
				: "border-slate-400/20 bg-slate-400/10 text-slate-400"
		}`}>
			<div className={`h-1.5 w-1.5 rounded-full ${enabled ? "bg-emerald-400" : "bg-slate-500"}`} />
			{enabled ? "已启用" : "已停用"}
		</span>
	);
}

function InfoRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-baseline gap-3">
			<span className="w-[108px] shrink-0 text-xs text-slate-500">{label}</span>
			<span className="text-sm text-white truncate">{value}</span>
		</div>
	);
}
