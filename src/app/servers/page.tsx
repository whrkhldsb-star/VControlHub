import { cookies } from "next/headers";
import Link from "next/link";
import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listServerProfiles } from "@/lib/server/service";
import { PageShell, PageHeader, StatCard, EmptyState } from "@/components/page-shell";
import { getSessionCookieName } from "@/lib/auth/session";
import { logError } from "@/lib/logging";
import { getServerLocale, t } from "@/lib/i18n/translations";

import { getServerFormOptions } from "./actions";
import { BatchServerActionPanel } from "./batch-server-action-panel";
import { ServerCreateForm } from "./server-create-form";
import { SshKeyCreateForm } from "./ssh-key-create-form";
import { ServerTabLayout } from "./server-tab-layout";
import { ServerOverviewCard } from "./server-overview-card";
import { AutoProbeProvider } from "./auto-probe-context";
import { SshTerminalProvider } from "./ssh-terminal-context";

export const dynamic = "force-dynamic";

export default async function ServersPage() {
  const locale = await getServerLocale();
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
				eyebrow={t("serversPage.eyebrow", locale)}
				title={t("serversPage.title")}
				description={t("serversPage.desc")}
			>
				<div className="flex flex-wrap items-center gap-2">
					<Link href="/requests" data-variant="primary" className="px-3.5 py-2 text-sm">
						{t("serversPage.link.request")}
					</Link>
					<Link href="/audit" data-variant="secondary" className="px-3.5 py-2 text-sm">
						{t("serversPage.link.audit")}
					</Link>
					<Link href="/deployments" data-variant="secondary" className="px-3.5 py-2 text-sm">
						{t("serversPage.link.deploy")}
					</Link>
				</div>
			</PageHeader>

			<section className="grid gap-3 sm:grid-cols-3 mb-6">
				<StatCard label={t("serversPage.stat.total")} value={String(servers.length)} />
				<StatCard label={t("serversPage.stat.enabled")} value={String(enabledCount)} accent={enabledCount > 0} accentColor="emerald" />
				<StatCard label={t("serversPage.stat.storage")} value={String(storageCount)} accent={storageCount > 0} accentColor="cyan" />
			</section>
			<section className="mb-5 rounded-2xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--accent-bg)_45%,var(--surface))] px-4 py-3.5">
				<div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<h2 className="text-sm font-semibold text-[var(--text-primary)]">{t("serversPage.statusPriority.title")}</h2>
						<p className="mt-0.5 text-xs leading-5 text-[var(--text-muted)]">{t("serversPage.statusPriority.desc")}</p>
					</div>
					<span className="mt-2 inline-flex w-fit items-center rounded-full border border-[var(--accent-border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--accent)] sm:mt-0">
						{enabledCount}/{servers.length}
					</span>
				</div>
			</section>

			<SshTerminalProvider>
			<AutoProbeProvider>
			<ServerTabLayout
				nodesPanel={
					<div className="space-y-4">
						<section aria-label={t("serversPage.overview.aria")} className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
							{servers.length === 0 ? (
								<EmptyState text={t("serversPage.overview.empty")} />
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
					canManageServers ? <ServerCreateForm sshKeys={formOptions.sshKeys} /> : <EmptyState text={t("serversPage.noManage")} />
				}
				sshKeysPanel={
					<div>
						{canManageServers ? <SshKeyCreateForm /> : <EmptyState text={t("serversPage.noManage")} />}
					</div>
				}
				batchPanel={
					canManageServers && servers.length > 0 ? (
						<BatchServerActionPanel servers={servers.map((server) => ({ id: server.id, name: server.name, enabled: server.enabled }))} enabledCount={enabledServers.length} />
					) : (
						<EmptyState text={t("serversPage.batchEmpty")} />
					)
				}
			/>
			</AutoProbeProvider>
			</SshTerminalProvider>
			</PageShell>
	);
}


