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
import { ServerCreateForm } from "./server-create-form";
import { SshKeyCreateForm } from "./ssh-key-create-form";
import { ServerTabLayout } from "./server-tab-layout";
import { ServerOverviewCard } from "./server-overview-card";

export const dynamic = "force-dynamic";

export default async function ServersPage() {
	const session = await requireSession("/servers");
	const canManageServers = sessionHasPermission(session, "server:write");
	const canUseSshTerminal = sessionHasPermission(session, "server:ssh");
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
						<h1 className="text-3xl font-semibold tracking-tight text-white light:text-slate-900">VPS 管理</h1>
						<p className="mt-1.5 text-sm text-slate-500">
							聚焦 VPS 节点、SSH 密钥与直连网关维护；命令审批与投递记录统一进入审批中心。
						</p>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<Link href="/requests" className="rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-3.5 py-2 text-sm text-cyan-100 light:text-cyan-900 transition hover:bg-cyan-400/15">
							命令下发
						</Link>
						<Link href="/audit" className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3.5 py-2 text-sm text-slate-200 light:text-slate-800 transition hover:bg-white/[0.06]">
							查看审计日志
						</Link>
						<Link href="/deployments" className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3.5 py-2 text-sm text-slate-200 light:text-slate-800 transition hover:bg-white/[0.06]">
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
			<section className="mb-4 rounded-xl border border-cyan-400/15 bg-cyan-400/[0.04] p-4">
				<h2 className="text-sm font-medium text-cyan-100 light:text-cyan-900">VPS 状态优先</h2>
				<p className="mt-1 text-xs text-slate-400 light:text-slate-600">默认先展示各 VPS 的启用状态、连接方式、密钥绑定、直连模式和待审批命令；添加 VPS、添加密钥、批量操作已收入口到快捷操作区。</p>
			</section>

			<ServerTabLayout
				nodesPanel={
					<div className="space-y-4">
						<section aria-label="VPS 状态总览" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
							{servers.length === 0 ? (
								<EmptyState text="暂无已纳管 VPS。使用上方“添加 VPS”录入 SSH 密钥、IP 与端口完成纳管。" />
							) : (
								servers.map((server) => (
									<ServerOverviewCard
										key={server.id}
										server={server}
										sessionToken={sessionToken}
										canManageServers={canManageServers}
										canUseSshTerminal={canUseSshTerminal}
									/>
								))
							)}
						</section>
					</div>
				}
				createPanel={
					canManageServers ? <ServerCreateForm sshKeys={formOptions.sshKeys} /> : <EmptyState text="当前角色无节点纳管权限。" />
				}
				sshKeysPanel={
					<div>
						{canManageServers ? <SshKeyCreateForm /> : <EmptyState text="当前角色无节点纳管权限。" />}
					</div>
				}
				batchPanel={
					canManageServers && servers.length > 0 ? (
						<BatchServerActionPanel servers={servers.map((server) => ({ id: server.id, name: server.name, enabled: server.enabled }))} enabledCount={enabledServers.length} />
					) : (
						<EmptyState text="暂无可批量操作的 VPS。" />
					)
				}
			/>
		</PageShell>
	);
}


