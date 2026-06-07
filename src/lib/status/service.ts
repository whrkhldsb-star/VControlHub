import { prisma } from "@/lib/db";
import { summarizeSystemHealth, type SystemHealthCheck } from "@/lib/system-health/service";
import { getAppSlug } from "@/lib/branding";

export async function getPublicStatus() {
	const checks: SystemHealthCheck[] = [];
	try {
		await prisma.$queryRaw`SELECT 1`;
		checks.push({ id: "database", label: "数据库", status: "healthy", message: "可用" });
	} catch {
		checks.push({ id: "database", label: "数据库", status: "critical", message: "不可用" });
	}
	const [serverCount, storageNodeCount] = await Promise.all([
		prisma.server.count({ where: { enabled: true } }).catch(() => 0),
		prisma.storageNode.count().catch(() => 0),
	]);
	checks.push({
		id: "servers",
		label: "VPS 管理",
		status: serverCount > 0 ? "healthy" : "warning",
		message: serverCount > 0 ? `已启用 ${serverCount} 台 VPS，未做实时 SSH/网络探测` : "等待配置",
	});
	checks.push({
		id: "storage",
		label: "云盘服务",
		status: storageNodeCount > 0 ? "healthy" : "warning",
		message: storageNodeCount > 0 ? `已配置 ${storageNodeCount} 个存储节点，未做实时 SFTP/直连探测` : "等待配置",
	});
	return { generatedAt: new Date().toISOString(), service: getAppSlug(), summary: summarizeSystemHealth(checks), checks: checks.map(({ id, label, status, message }) => ({ id, label, status, message })) };
}
