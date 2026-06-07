import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db";
import { buildDirectAccessStrategy } from "@/lib/storage/service";
import { DownloadsClient } from "./downloads-client";
import { PageShell, EmptyState } from "@/components/page-shell";

export const dynamic = "force-dynamic";

export default async function DownloadsPage() {
	const session = await requireSession("/downloads");
	const canManage = sessionHasPermission(session, "storage:write");
	const canManageNode = sessionHasPermission(session, "storage:manage-node");
	const canRead = sessionHasPermission(session, "storage:read");

	if (!canRead) {
		return <PageShell maxW="max-w-7xl"><EmptyState text="你没有下载管理的权限。" variant="boxed" /></PageShell>;
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
		return {
			id: s.id,
			name: s.name,
			host: s.host,
			storagePath: s.storageNode?.basePath ?? "/root/downloads",
			storageDriver: s.storageNode?.driver ?? "LOCAL",
			directAccessMode: s.storageNode?.directAccessMode ?? "PROXY",
			directAccessAvailable: isDirect,
			accessTransport: isDirect ? "direct" as const : "relay" as const,
			accessStatusLabel: isDirect ? "当前：直连" : "当前：中转",
			accessDescription: strategy.description,
		};
	});

	return (
		<PageShell maxW="max-w-7xl">
			<header className="mb-8">
				<h1 className="text-3xl font-semibold tracking-tight text-white light:text-slate-900">远程下载</h1>
				<p className="mt-1.5 text-sm text-slate-500">
					输入 URL 或磁力链接，下载到指定 VPS 的存储路径
				</p>
			</header>
			<DownloadsClient servers={serverList} canManage={canManage} canManageNode={canManageNode} />
		</PageShell>
	);
}
