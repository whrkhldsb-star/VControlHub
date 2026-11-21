import { readableBoundDriveIds } from "@/lib/server/inventory";
import { downloadDriveSelect } from "@/lib/downloads/destination";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { isGlobalTeamManager, serverTeamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { buildDirectAccessStrategy } from "@/lib/storage/service";
import { DownloadsClient } from "./downloads-client";
import { PageShell, PageHeader } from "@/components/page-shell";
import { getServerLocale, t } from "@/lib/i18n/translations";

export const dynamic = "force-dynamic";

export default async function DownloadsPage() {
	const session = await requirePagePermission("storage:read", { redirectTo: "/downloads" });
	const locale = await getServerLocale();
	const canManage = sessionHasPermission(session, "storage:write");
	// The global aria2 limit is platform-wide; PATCH requires a platform-level manager (A5-12).
	const canManageNode = isGlobalTeamManager(session) && sessionHasPermission(session, "storage:manage-node");

	// Strict server scope (null teamId is quarantined legacy data); AND-compose so
	// the credential OR below is not overwritten.
	const servers = await prisma.server.findMany({
		where: {
			AND: [
				serverTeamWhere(session, "connect"),
				{
					enabled: true,
					AND: [{ OR: [{ storageNode: { isNot: null } }, { managementMode: "AGENT", agentFileShares: { some: {} } }] }],
					// Direct downloads only need to run a command, which Agent-managed nodes do over the Agent (A5-13).
					OR: [{ sshKeyId: { not: null } }, { password: { not: null } }, { managementMode: "AGENT" }],
				},
			],
		},
		take: 200,
		select: {
			id: true,
			teamId: true,
			name: true,
			host: true,
			storageNode: { select: { ...downloadDriveSelect, teamId: true } },
			managementMode: true,
			agentFileShares: { orderBy: { storageNodeId: "asc" }, select: { teamId: true, node: { select: { ...downloadDriveSelect, teamId: true } } } },
		},
		orderBy: { name: "asc" },
	});

	const readable = await readableBoundDriveIds(session);
	const viewConnection = sessionHasPermission(session, "storage:manage-node");
	const serverList = servers.flatMap(server => {
		const drives = [
			...(server.storageNode ? [server.storageNode] : []),
			...(server.managementMode === "AGENT" ? server.agentFileShares.filter(share => share.teamId === server.teamId).map(share => share.node) : []),
		].filter(node => node.teamId === server.teamId && (!readable || readable.has(node.id)));
		return drives.map(storageNode => ({ ...server, storageNode, multiple: drives.length > 1 }));
	}).map(s => {
		const strategy = buildDirectAccessStrategy({
			driver: s.storageNode.driver,
			nodeId: s.storageNode?.id ?? "",
			host: s.storageNode?.host ?? s.host,
			port: s.storageNode?.port,
			relativePath: null,
			directAccessMode: s.storageNode?.directAccessMode,
			publicBaseUrl: s.storageNode?.publicBaseUrl,
			directAccessExpiresSeconds: s.storageNode?.directAccessExpiresSeconds,
		});
		const isDirect = strategy.mode === "direct-url";
		const host = s.storageNode?.host ?? s.host;
		const port = s.storageNode?.port ?? 22;
		const accessStatusLabel = t(isDirect ? "downloadsPage.access.direct" : "downloadsPage.access.relay", locale);
		const accessDescription = !viewConnection ? accessStatusLabel
			: s.storageNode.driver === "AGENT" ? strategy.description
			: s.storageNode.driver === "LOCAL"
			? t("downloadsPage.access.localDesc", locale)
			: isDirect
				? t(s.storageNode?.directAccessMode === "AUTO" ? "downloadsPage.access.directAutoDesc" : "downloadsPage.access.directModeDesc", locale, { host, port })
				: t("downloadsPage.access.relayDesc", locale, { host, port });
		return {
			id: s.storageNode.driver === "AGENT" ? `drive:${s.storageNode.id}` : s.id,
			serverId: s.id, storageNodeId: s.storageNode.id,
			name: s.multiple || s.storageNode.driver === "AGENT" ? `${s.name} · ${s.storageNode.name} (${s.storageNode.driver})` : s.name,
			host: viewConnection ? s.host : "",
			storagePath: viewConnection ? s.storageNode.basePath : "",
			storageDriver: s.storageNode?.driver ?? "LOCAL",
			directAccessMode: s.storageNode?.directAccessMode ?? "PROXY",
			directAccessAvailable: isDirect,
			accessTransport: isDirect ? "direct" as const : "relay" as const,
			accessStatusLabel,
			accessDescription,
		};
	});

	return (
		<PageShell>
			<PageHeader
				eyebrow={t("downloadsPage.header.eyebrow", locale)}
				title={t("downloadsPage.header.title", locale)}
				description={t("downloadsPage.header.description", locale)}
			/>
			<DownloadsClient servers={serverList} canManage={canManage} canManageNode={canManageNode} />
		</PageShell>
	);
}
