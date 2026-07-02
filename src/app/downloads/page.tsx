import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db";
import { buildDirectAccessStrategy } from "@/lib/storage/service";
import { DownloadsClient } from "./downloads-client";
import { PageShell, PageHeader, EmptyState } from "@/components/page-shell";
import { getServerLocale, t } from "@/lib/i18n/translations";

export const dynamic = "force-dynamic";

export default async function DownloadsPage() {
	const session = await requireSession("/downloads");
	const locale = await getServerLocale();
	const canManage = sessionHasPermission(session, "storage:write");
	const canManageNode = sessionHasPermission(session, "storage:manage-node");
	const canRead = sessionHasPermission(session, "storage:read");

	if (!canRead) {
		return <PageShell maxW="max-w-7xl"><EmptyState text={t("downloadsPage.permissionDenied", locale)} variant="boxed" /></PageShell>;
	}

	const servers = await prisma.server.findMany({
		where: {
			enabled: true,
			storageNode: { isNot: null },
			OR: [{ sshKeyId: { not: null } }, { password: { not: null } }],
		},
		take: 200,
		select: {
			id: true,
			name: true,
			host: true,
			storageNode: { select: { id: true, basePath: true, driver: true, host: true, port: true, directAccessMode: true, publicBaseUrl: true, directAccessExpiresSeconds: true } },
		},
		orderBy: { name: "asc" },
	});

	const serverList = servers.map((s) => {
		const strategy = buildDirectAccessStrategy({
			driver: s.storageNode?.driver === "SFTP" ? "SFTP" : "LOCAL",
			nodeId: s.storageNode?.id ?? "",
			host: s.storageNode?.host ?? s.host,
			port: s.storageNode?.port,
			relativePath: ".",
			directAccessMode: s.storageNode?.directAccessMode,
			publicBaseUrl: s.storageNode?.publicBaseUrl,
			directAccessExpiresSeconds: s.storageNode?.directAccessExpiresSeconds,
		});
		const isDirect = strategy.mode === "direct-url";
		const host = s.storageNode?.host ?? s.host;
		const port = s.storageNode?.port ?? 22;
		const accessDescription = s.storageNode?.driver === "LOCAL"
			? t("downloadsPage.access.localDesc", locale)
			: isDirect
				? t(s.storageNode?.directAccessMode === "AUTO" ? "downloadsPage.access.directAutoDesc" : "downloadsPage.access.directModeDesc", locale)
					.replace("{host}", host)
					.replace("{port}", String(port))
				: t("downloadsPage.access.relayDesc", locale).replace("{host}", host).replace("{port}", String(port));
		void strategy;
		return {
			id: s.id,
			name: s.name,
			host: s.host,
			storagePath: s.storageNode?.basePath ?? "/root/downloads",
			storageDriver: s.storageNode?.driver ?? "LOCAL",
			directAccessMode: s.storageNode?.directAccessMode ?? "PROXY",
			directAccessAvailable: isDirect,
			accessTransport: isDirect ? "direct" as const : "relay" as const,
			accessStatusLabel: isDirect ? t("downloadsPage.access.direct", locale) : t("downloadsPage.access.relay", locale),
			accessDescription,
		};
	});

	return (
		<PageShell maxW="max-w-7xl">
			<PageHeader
				eyebrow={t("downloadsPage.header.eyebrow", locale)}
				title={t("downloadsPage.header.title", locale)}
				description={t("downloadsPage.header.description", locale)}
			/>
			<DownloadsClient servers={serverList} canManage={canManage} canManageNode={canManageNode} />
		</PageShell>
	);
}
