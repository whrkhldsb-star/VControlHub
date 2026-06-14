import { cookies } from "next/headers";
import Link from "next/link";
import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listServerProfiles } from "@/lib/server/service";
import { PageShell, PageHeader, StatCard, EmptyState } from "@/components/page-shell";
import { getSessionCookieName } from "@/lib/auth/session";
import { logError } from "@/lib/logging";

import { getServerFormOptions } from "./actions";
import { BatchServerActionPanel } from "./batch-server-action-panel";
import { ServerCreateForm } from "./server-create-form";
import { SshKeyCreateForm } from "./ssh-key-create-form";
import { ServerTabLayout } from "./server-tab-layout";
import { ServerOverviewCard } from "./server-overview-card";
import { AutoProbeProvider } from "./auto-probe-context";
import { AutoProbeControls } from "./auto-probe-controls";

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
			<PageHeader
				eyebrow="Infrastructure"
				title="VPS 管理"
				description="聚焦 VPS 节点、SSH 密钥与直连网关维护；命令审批与投递记录统一进入审批中心。"
			>
				<div className="flex flex-wrap items-center gap-2">
					<Link href="/requests" data-variant="primary" className="px-3.5 py-2 text-sm">
						命令下发
					</Link>
					<Link href="/audit" data-variant="secondary" className="px-3.5 py-2 text-sm">
						查看审计日志
					</Link>
					<Link href="/deployments" data-variant="secondary" className="px-3.5 py-2 text-sm">
						去部署面板
					</Link>
				</div>
			</PageHeader>

			<section className="grid gap-3 sm:grid-cols-3 mb-8">
				<StatCard label="节点总数" value={String(servers.length)} />
				<StatCard label="启用节点" value={String(enabledCount)} accent={enabledCount > 0} />
				<StatCard label="已绑定存储" value={String(storageCount)} accent={storageCount > 0} />
			</section>
			<section data-tone="cyan" className="mb-4 rounded-xl border border-cyan-400/15 p-4">
				<h2 className="text-sm font-medium text-cyan-100">VPS 状态优先</h2>
				<p className="mt-1 text-xs text-slate-400">默认先展示各 VPS 的启用状态、连接方式、密钥绑定、直连模式和待审批命令；添加 VPS、添加密钥、批量操作已收入口到快捷操作区。</p>
			</section>

			<AutoProbeProvider>
			<ServerTabLayout
				nodesPanel={
					<div className="space-y-4">
						<AutoProbeControls />
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
			</AutoProbeProvider>
		</PageShell>
	);
}


