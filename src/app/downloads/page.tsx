import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db";
import { DownloadsClient } from "./downloads-client";
import { PageShell, EmptyState } from "@/components/page-shell";

export const dynamic = "force-dynamic";

export default async function DownloadsPage() {
	const session = await requireSession("/downloads");
	const canManage = sessionHasPermission(session, "storage:write");
	const canRead = sessionHasPermission(session, "storage:read");

	if (!canRead) {
		return <PageShell maxW="max-w-7xl"><EmptyState text="你没有下载管理的权限。" variant="boxed" /></PageShell>;
	}

	const servers = await prisma.server.findMany({
		where: { enabled: true },
		take: 200,
		select: {
			id: true,
			name: true,
			host: true,
			storageNode: { select: { id: true, basePath: true, driver: true } },
		},
		orderBy: { name: "asc" },
	});

	const serverList = servers.map((s) => ({
		id: s.id,
		name: s.name,
		host: s.host,
		storagePath: s.storageNode?.basePath ?? "/root/downloads",
		storageDriver: s.storageNode?.driver ?? "LOCAL",
	}));

	return (
		<PageShell maxW="max-w-7xl">
			<header className="mb-8">
				<h1 className="text-3xl font-semibold tracking-tight text-white">远程下载</h1>
				<p className="mt-1.5 text-sm text-slate-500">
					输入 URL 或磁力链接，下载到指定 VPS 的存储路径
				</p>
			</header>
			<DownloadsClient servers={serverList} canManage={canManage} />
		</PageShell>
	);
}
