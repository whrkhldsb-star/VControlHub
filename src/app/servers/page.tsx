import { requirePagePermission } from "@/lib/auth/page-guard";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { getServerInventory } from "@/lib/server/inventory";
import { PageShell, PageHeader, StatCard } from "@/components/page-shell";
import { logError } from "@/lib/logging";
import { getServerLocale, t as translate, type TFn } from "@/lib/i18n/translations";

import { getServerFormOptions } from "./actions";
import { ServerOperationPanel } from "./server-operation-panel";
import { ServerCreateForm } from "./server-create-form";
import { SshKeyCreateForm } from "./ssh-key-create-form";
import { ServerTabLayout } from "./server-tab-layout";
import { ServerInventory } from "./server-inventory";
import { AutoProbeProvider } from "./auto-probe-context";
import { ButtonLink } from "@/components/action-button";

export const dynamic = "force-dynamic";

export default async function ServersPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = await getServerLocale();
	const t: TFn = (key, vars) => translate(key, locale, vars);
	const session = await requirePagePermission("server:read", { redirectTo: "/servers" });
	const canManageServers = sessionHasPermission(session, "server:write");
	const canUseSshTerminal = sessionHasPermission(session, "server:ssh");
	const canLaunchCommands = sessionHasPermission(session, "command:create");
	const canExecuteCommands = sessionHasPermission(session, "command:execute");
	const canApproveCommands = sessionHasPermission(session, "command:approve");
	const canReadAudit = sessionHasPermission(session, "audit:read");
	const canReadDeployments = sessionHasPermission(session, "deploy:read");
	const canUseAi = sessionHasPermission(session, "ai:chat");
	let inventory, formOptions;
	try {
		[inventory, formOptions] = await Promise.all([
			getServerInventory(session, await searchParams),
			canManageServers ? getServerFormOptions() : Promise.resolve({ sshKeys: [] }),
		]);
	} catch (e) {
		logError("[ServersPage] Data fetch error:", e);
		throw e;
	}

	const { stats } = inventory;

	return (
		<PageShell maxW="max-w-7xl">
			<PageHeader
				eyebrow={t("serversPage.eyebrow")}
				title={t("serversPage.title")}
				description={t("serversPage.desc")}
			>
				<div className="flex flex-wrap items-center gap-2">
					{canApproveCommands ? <ButtonLink variant="secondary" href="/requests">
						{t("serversPage.link.request")}
					</ButtonLink> : null}
					{canReadAudit ? <ButtonLink variant="secondary" href="/audit">
						{t("serversPage.link.audit")}
					</ButtonLink> : null}
					{canReadDeployments ? <ButtonLink variant="secondary" href="/deployments">
						{t("serversPage.link.deploy")}
					</ButtonLink> : null}
					{canUseAi ? <ButtonLink variant="outline" href={`/ai?q=${encodeURIComponent(t("serversPage.askAiFleetPrefill"))}`}>
						{t("serversPage.askAi")}
					</ButtonLink> : null}
				</div>
			</PageHeader>

			{stats.total > 0 ? <section className="mb-5 grid gap-3 sm:grid-cols-3">
				<StatCard label={t("serversPage.stat.total")} value={String(stats.total)} />
				<StatCard label={t("serversPage.stat.enabled")} value={String(stats.enabled)} accent={stats.enabled > 0} accentColor="emerald" />
				<StatCard label={t("serversPage.stat.storage")} value={String(stats.storage)} accent={stats.storage > 0} accentColor="cyan" />
			</section> : null}

			<AutoProbeProvider>
			<ServerTabLayout
				initialPanel={stats.total === 0 && canManageServers ? "create" : "nodes"}
				nodesPanel={
					<ServerInventory inventory={inventory} canManageServers={canManageServers} canUseSshTerminal={canUseSshTerminal} />
				}
				commandPanel={canLaunchCommands ? <ServerOperationPanel key={inventory.loadedAt} kind="command" allowDirectExecution={canExecuteCommands} /> : undefined}
				createPanel={
					canManageServers ? <ServerCreateForm sshKeys={formOptions.sshKeys} /> : undefined
				}
				sshKeysPanel={
					canManageServers ? <SshKeyCreateForm /> : undefined
				}
				batchPanel={canManageServers ? <ServerOperationPanel key={inventory.loadedAt} kind="batch" /> : undefined}
			/>
			</AutoProbeProvider>
			</PageShell>
	);
}
