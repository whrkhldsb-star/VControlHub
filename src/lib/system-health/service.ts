import { access } from "node:fs/promises";
import { join, relative } from "node:path";
import { execSync } from "node:child_process";

import { prisma } from "@/lib/db";

export type SystemHealthStatus = "healthy" | "warning" | "critical";

export type SystemHealthCheck = {
  id: string;
  label: string;
  status: SystemHealthStatus;
  message: string;
  detail?: string;
};

export type SystemHealthSummary = {
  total: number;
  healthy: number;
  warning: number;
  critical: number;
  overall: SystemHealthStatus;
};

export type SystemHealthReport = {
  generatedAt: string;
  summary: SystemHealthSummary;
  checks: SystemHealthCheck[];
};

const RUNTIME_DIRS = ["storage", "uploads", "downloads", "backups", "logs", "tmp"];
const SERVICE_CHECKS = [
	{ id: "next-service", label: "Next.js 服务", unit: "whrkhldsb-next.service" },
	{ id: "ssh-ws-service", label: "SSH WebSocket 服务", unit: "whrkhldsb-ssh-ws.service" },
	{ id: "caddy-service", label: "Caddy 反代服务", unit: "caddy.service" },
];
const SECRET_PATTERNS = [/postgres:\/\/[^\s]+:[^\s]+@/gi, /(password|token|secret|private_key)=([^\s]+)/gi];

function sanitizeDetail(value: string) {
  return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, (_match, key) => key ? `${key}=[REDACTED]` : "[REDACTED]"), value);
}

function safeExec(command: string): string | null {
  try {
    return execSync(command, { encoding: "utf8", timeout: 5000 }).trim();
  } catch {
    return null;
  }
}

export function summarizeSystemHealth(checks: SystemHealthCheck[]): SystemHealthSummary {
  const summary = checks.reduce(
    (acc, check) => {
      acc[check.status] += 1;
      return acc;
    },
    { total: checks.length, healthy: 0, warning: 0, critical: 0, overall: "healthy" as SystemHealthStatus },
  );
  summary.overall = summary.critical > 0 ? "critical" : summary.warning > 0 ? "warning" : "healthy";
  return summary;
}

async function checkPathExists(projectRoot: string, dir: string): Promise<SystemHealthCheck> {
  const absolute = join(projectRoot, dir);
  try {
    await access(absolute);
    return { id: `dir-${dir}`, label: `运行目录 ${dir}`, status: "healthy", message: "目录存在", detail: relative(projectRoot, absolute) };
  } catch {
    return { id: `dir-${dir}`, label: `运行目录 ${dir}`, status: "warning", message: "目录不存在，部署脚本会自动创建", detail: dir };
  }
}

export async function collectSystemHealthChecks(options: { projectRoot?: string } = {}): Promise<SystemHealthReport> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const checks: SystemHealthCheck[] = [];

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.push({ id: "database", label: "数据库连接", status: "healthy", message: "数据库可查询" });
  } catch (error) {
    checks.push({ id: "database", label: "数据库连接", status: "critical", message: "数据库不可用", detail: sanitizeDetail(error instanceof Error ? error.message : String(error)) });
  }

  const [serverCount, storageNodeCount] = await Promise.all([
    prisma.server.count().catch(() => -1),
    prisma.storageNode.count().catch(() => -1),
  ]);
  checks.push({
    id: "server-inventory",
    label: "VPS 节点资产",
    status: serverCount >= 0 ? "healthy" : "warning",
    message: serverCount >= 0 ? `已纳管 ${serverCount} 个 VPS 节点` : "无法读取 VPS 节点",
  });
  checks.push({
    id: "storage-inventory",
    label: "云盘存储节点",
    status: storageNodeCount > 0 ? "healthy" : "warning",
    message: storageNodeCount > 0 ? `已配置 ${storageNodeCount} 个存储节点` : "尚未配置存储节点",
  });

  const dirChecks = await Promise.all(RUNTIME_DIRS.map((dir) => checkPathExists(projectRoot, dir)));
  checks.push({ id: "runtime-directories", label: "运行目录基线", status: dirChecks.some((c) => c.status !== "healthy") ? "warning" : "healthy", message: `${dirChecks.filter((c) => c.status === "healthy").length}/${dirChecks.length} 个运行目录可用` });
  checks.push(...dirChecks);

  const serviceChecks = SERVICE_CHECKS.map((service) => {
    const state = safeExec(`systemctl is-active ${service.unit}`);
    if (state === "active") {
      return { id: service.id, label: service.label, status: "healthy" as const, message: `${service.unit} 正在运行` };
    }
    if (state) {
      return { id: service.id, label: service.label, status: "critical" as const, message: `${service.unit} 当前状态为 ${state}` };
    }
    return { id: service.id, label: service.label, status: "warning" as const, message: `${service.unit} 状态暂不可读` };
  });
  checks.push(...serviceChecks);

  const envState = process.env.DATABASE_URL && process.env.DATABASE_URL !== "REPLACE_WITH_DATABASE_URL" ? "healthy" : "critical";
  checks.push({ id: "env-database-url", label: "数据库环境变量", status: envState, message: envState === "healthy" ? "DATABASE_URL 已配置" : "DATABASE_URL 未配置或仍是占位符" });

  const settings = await prisma.setting.findMany({ where: { key: { startsWith: "notification." } } }).catch(() => []);
  checks.push({ id: "notification-settings", label: "通知渠道配置", status: settings.length > 0 ? "healthy" : "warning", message: settings.length > 0 ? `已保存 ${settings.length} 项通知渠道配置` : "可在系统设置中配置通知渠道" });

  const gitHead = safeExec(`git -C ${JSON.stringify(projectRoot)} rev-parse --short HEAD`);
  const gitRemoteHead = safeExec(`git -C ${JSON.stringify(projectRoot)} ls-remote origin refs/heads/main | awk '{print $1}' | cut -c1-7`);
  if (gitHead) {
    const gitHealthy = !gitRemoteHead || gitHead === gitRemoteHead;
    checks.push({
      id: "git-sync",
      label: "GitHub 同步状态",
      status: gitHealthy ? "healthy" : "warning",
      message: gitRemoteHead
        ? gitHealthy
          ? `本地提交 ${gitHead} 与 origin/main 一致`
          : `本地 ${gitHead} 与 origin/main ${gitRemoteHead} 不一致`
        : `当前提交 ${gitHead}，远端状态暂不可确认`,
    });
  } else {
    checks.push({
      id: "git-sync",
      label: "GitHub 同步状态",
      status: "warning",
      message: "当前目录不是可识别的 Git 仓库或无法读取 HEAD",
    });
  }

  return { generatedAt: new Date().toISOString(), summary: summarizeSystemHealth(checks), checks };
}
