import { prisma } from "@/lib/db";
import { summarizeSystemHealth, type SystemHealthCheck } from "@/lib/system-health/service";

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
  checks.push({ id: "servers", label: "VPS 管理", status: serverCount > 0 ? "healthy" : "warning", message: serverCount > 0 ? "服务在线" : "等待配置" });
  checks.push({ id: "storage", label: "云盘服务", status: storageNodeCount > 0 ? "healthy" : "warning", message: storageNodeCount > 0 ? "服务在线" : "等待配置" });
  return { generatedAt: new Date().toISOString(), service: "whrkhldsb", summary: summarizeSystemHealth(checks), checks: checks.map(({ id, label, status, message }) => ({ id, label, status, message })) };
}
