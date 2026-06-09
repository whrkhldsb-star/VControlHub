import { prisma } from "@/lib/db";
import { summarizeSystemHealth, type SystemHealthCheck, type SystemHealthStatus } from "@/lib/system-health/service";
import { getAppSlug } from "@/lib/branding";

type StorageHealthAggregate = {
  total: number;
  healthy: number;
  unhealthy: number;
  unknown: number;
  checked: number;
};

function buildStorageStatus(input: StorageHealthAggregate): SystemHealthCheck {
  if (input.total <= 0) {
    return {
      id: "storage",
      label: "云盘服务",
      status: "warning",
      message: "等待配置",
    };
  }

  const status: SystemHealthStatus = input.unhealthy > 0 ? "warning" : input.checked > 0 ? "healthy" : "warning";
  const parts = [
    `已配置 ${input.total} 个存储节点`,
    `${input.healthy} 个最近探测健康`,
    `${input.unhealthy} 个异常`,
    `${input.unknown} 个待探测`,
  ];

  return {
    id: "storage",
    label: "云盘服务",
    status,
    message: `${parts.join("，")}；不会在公开状态页展示 SFTP/Direct Gateway 主机、端口或路径。`,
  };
}

export async function getPublicStatus() {
	const checks: SystemHealthCheck[] = [];
	try {
		await prisma.$queryRaw`SELECT 1`;
		checks.push({ id: "database", label: "数据库", status: "healthy", message: "可用" });
	} catch {
		checks.push({ id: "database", label: "数据库", status: "critical", message: "不可用" });
	}
	const [serverCount, storageNodes] = await Promise.all([
		prisma.server.count({ where: { enabled: true } }).catch(() => 0),
		prisma.storageNode.findMany({ select: { healthStatus: true, lastHealthCheckAt: true } }).catch(() => []),
	]);
	checks.push({
		id: "servers",
		label: "VPS 管理",
		status: serverCount > 0 ? "healthy" : "warning",
		message: serverCount > 0 ? `已启用 ${serverCount} 台 VPS，未做实时 SSH/网络探测` : "等待配置",
	});
	const storageAggregate = storageNodes.reduce<StorageHealthAggregate>(
		(acc, node) => {
			acc.total += 1;
			if (!node.lastHealthCheckAt || node.healthStatus === "UNKNOWN" || !node.healthStatus) {
				acc.unknown += 1;
			} else if (node.healthStatus === "HEALTHY") {
				acc.healthy += 1;
				acc.checked += 1;
			} else if (node.healthStatus === "UNHEALTHY") {
				acc.unhealthy += 1;
				acc.checked += 1;
			} else {
				acc.unknown += 1;
			}
			return acc;
		},
		{ total: 0, healthy: 0, unhealthy: 0, unknown: 0, checked: 0 },
	);
	checks.push(buildStorageStatus(storageAggregate));
	return { generatedAt: new Date().toISOString(), service: getAppSlug(), summary: summarizeSystemHealth(checks), checks: checks.map(({ id, label, status, message }) => ({ id, label, status, message })) };
}
