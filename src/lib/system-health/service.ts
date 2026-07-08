import { access } from "node:fs/promises";
import { join, relative } from "node:path";

import { prisma } from "@/lib/db";
import { config } from "@/lib/config/env";
import { runHealthCheckCommand } from "./command-runner";

export type SystemHealthStatus = "healthy" | "warning" | "critical";

export type SystemHealthCheck = {
  id: string;
  label: string;
  status: SystemHealthStatus;
  message: string;
  detail?: string;
  params?: Record<string, string | number>;
  messageCode?: string;
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
	{ id: "next-service", label: "Next.js service", unit: "vcontrolhub-next.service" },
	{ id: "ssh-ws-service", label: "SSH WebSocket service", unit: "vcontrolhub-ssh-ws.service" },
	{ id: "caddy-service", label: "Caddy reverse proxy service", unit: "caddy.service" },
];
const SECRET_PATTERNS = [/postgres:\/\/[^\s]+:[^\s]+@/gi, /(password|token|secret|private_key)=([^\s]+)/gi];

function sanitizeDetail(value: string) {
  return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, (_match, key) => key ? `${key}=[REDACTED]` : "[REDACTED]"), value);
}

function safeExecFile(file: string, args: string[]): string | null {
  return runHealthCheckCommand({ file, args });
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
    return { id: `dir-${dir}`, label: `Runtime directory ${dir}`, status: "healthy", message: "Directory exists", detail: relative(projectRoot, absolute), params: { name: dir }, messageCode: "healthy" };
  } catch {
    return { id: `dir-${dir}`, label: `Runtime directory ${dir}`, status: "warning", message: "Directory does not exist; deployment script will create it automatically", detail: dir, params: { name: dir }, messageCode: "warning" };
  }
}

export async function collectSystemHealthChecks(options: { projectRoot?: string } = {}): Promise<SystemHealthReport> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const checks: SystemHealthCheck[] = [];

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.push({ id: "database", label: "Database connection", status: "healthy", message: "Database is queryable", messageCode: "healthy" });
  } catch (error) {
    checks.push({ id: "database", label: "Database connection", status: "critical", message: "Database is unavailable", detail: sanitizeDetail(error instanceof Error ? error.message : String(error)), messageCode: "critical" });
  }

  const [serverCount, storageNodeCount] = await Promise.all([
    prisma.server.count().catch(() => -1),
    prisma.storageNode.count().catch(() => -1),
  ]);
  checks.push({
    id: "server-inventory",
    label: "VPS node inventory",
    status: serverCount >= 0 ? "healthy" : "warning",
    message: serverCount >= 0 ? `${serverCount} VPS nodes under management` : "Unable to read VPS nodes",
    params: serverCount >= 0 ? { count: serverCount } : undefined,
    messageCode: serverCount >= 0 ? "healthy" : "warning",
  });
  checks.push({
    id: "storage-inventory",
    label: "Cloud drive storage nodes",
    status: storageNodeCount > 0 ? "healthy" : "warning",
    message: storageNodeCount > 0 ? `${storageNodeCount} storage nodes configured` : "No storage nodes configured yet",
    params: storageNodeCount > 0 ? { count: storageNodeCount } : undefined,
    messageCode: storageNodeCount > 0 ? "healthy" : "warning",
  });

  const dirChecks = await Promise.all(RUNTIME_DIRS.map((dir) => checkPathExists(projectRoot, dir)));
  const dirOk = dirChecks.filter((c) => c.status === "healthy").length;
  checks.push({ id: "runtime-directories", label: "Runtime directory baseline", status: dirOk < dirChecks.length ? "warning" : "healthy", message: `${dirOk}/${dirChecks.length} runtime directories available`, params: { ok: dirOk, total: dirChecks.length }, messageCode: dirOk < dirChecks.length ? "warning" : "healthy" });
  checks.push(...dirChecks);

  const serviceChecks = SERVICE_CHECKS.map((service): SystemHealthCheck => {
    const state = safeExecFile("systemctl", ["is-active", service.unit]);
    if (state === "active") {
      return { id: service.id, label: service.label, status: "healthy" as const, message: `${service.unit} is running`, params: { unit: service.unit }, messageCode: "running" };
    }
    if (state) {
      return { id: service.id, label: service.label, status: "critical" as const, message: `${service.unit} current state is ${state}`, params: { unit: service.unit, state }, messageCode: "state" };
    }
    return { id: service.id, label: service.label, status: "warning" as const, message: `${service.unit} status temporarily unreadable`, params: { unit: service.unit }, messageCode: "unreadable" };
  });
  checks.push(...serviceChecks);

  const envState = (() => {
    try {
      return config.db.url !== "REPLACE_WITH_DATABASE_URL" ? "healthy" : "critical";
    } catch {
      return "critical";
    }
  })();
  checks.push({ id: "env-database-url", label: "Database environment variable", status: envState, message: envState === "healthy" ? "DATABASE_URL is configured" : "DATABASE_URL is not configured or is still a placeholder", messageCode: envState });

  const settings = await prisma.setting.findMany({ where: { key: { startsWith: "notification." } }, take: 100 }).catch(() => []);
  checks.push({ id: "notification-settings", label: "Notification channel configuration", status: settings.length > 0 ? "healthy" : "warning", message: settings.length > 0 ? `${settings.length} notification channel configurations saved` : "Notification channels can be configured in system settings", params: settings.length > 0 ? { count: settings.length } : undefined, messageCode: settings.length > 0 ? "healthy" : "warning" });

  const gitHead = safeExecFile("git", ["-C", projectRoot, "rev-parse", "--short", "HEAD"]);
  const remoteLine = safeExecFile("git", ["-C", projectRoot, "ls-remote", "origin", "refs/heads/main"]);
  const gitRemoteHead = remoteLine?.split(/\s+/)[0]?.slice(0, 7) || null;
  if (gitHead) {
    const gitHealthy = !gitRemoteHead || gitHead === gitRemoteHead;
    checks.push({
      id: "git-sync",
      label: "GitHub sync status",
      status: gitHealthy ? "healthy" : "warning",
      message: gitRemoteHead
        ? gitHealthy
          ? `Local commit ${gitHead} matches origin/main`
          : `Local ${gitHead} does not match origin/main ${gitRemoteHead}`
        : `Current commit ${gitHead}; remote status cannot be confirmed`,
      params: gitRemoteHead
        ? gitHealthy
          ? { head: gitHead }
          : { head: gitHead, remote: gitRemoteHead }
        : { head: gitHead },
      messageCode: gitRemoteHead ? (gitHealthy ? "synced" : "differs") : "no-remote",
    });
  } else {
    checks.push({
      id: "git-sync",
      label: "GitHub sync status",
      status: "warning",
      message: "Current directory is not a recognizable Git repository or HEAD cannot be read",
      messageCode: "no-git",
    });
  }

  return { generatedAt: new Date().toISOString(), summary: summarizeSystemHealth(checks), checks };
}
