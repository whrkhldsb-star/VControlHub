/**
 * POST /api/servers/[id]/detect-os — 探测远端 VPS 的 OS 方言 (TR-041)
 *
 * 通过 SSH 连接到目标 VPS，执行 `cat /etc/os-release` 探测发行版信息，
 * 解析为 OsDialect 结构，序列化后保存到 Server.osDialect 字段。
 *
 * 设计要点：
 * 1. **权限**：需要 `server:ssh` 权限（与 reload 路由一致）
 * 2. **幂等**：可重复调用，每次覆盖 osDialect + osInfo
 * 3. **安全**：不返回密钥/密码等敏感信息，仅返回方言摘要
 * 4. **审计**：探测操作记录到 AuditLog
 * 5. **超时**：10 秒 SSH 超时（探测命令很短）
 * 6. **单次探测**：复用 detectOsDialect，避免重复 SSH cat /etc/os-release
 */

import { auditUserAction } from "@/lib/audit/service";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { createLogger } from "@/lib/logging";
import { buildSshParamsFromServer } from "@/lib/ssh/client";
import {
  detectOsDialect,
  serializeDialect,
  type OsDialect,
} from "@/lib/ssh/os-dialect";
import { assertServerTeamAccess } from "@/lib/server/team-access";

export const dynamic = "force-dynamic";
const logger = createLogger("api:servers:detect-os");

type ServerRow = {
  id: string;
  host: string;
  port: number;
  username: string;
  sshKeyId: string | null;
  password: string | null;
  hostKeySha256: string | null;
  sshKey: { privateKey: string; passphrase?: string | null } | null;
};

function dialectSummary(dialect: OsDialect) {
  return {
    packageManager: dialect.packageManager,
    serviceManager: dialect.serviceManager,
    distroName: dialect.distroName,
    distroFamily: dialect.distroFamily,
    detectedAt: dialect.detectedAt,
  };
}

async function loadServer(id: string): Promise<ServerRow | null> {
  const server = await prisma.server.findUnique({
    where: { id },
    select: {
      id: true,
      host: true,
      port: true,
      username: true,
      sshKeyId: true,
      password: true,
      hostKeySha256: true,
      sshKey: { select: { privateKey: true, passphrase: true } },
    },
  });
  return (server as ServerRow | null) ?? null;
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withApiRoute(
    _request,
    {
      requireAuth: true,
      rateLimit: GENERAL_WRITE_LIMIT,
    },
    async ({ session }) => {
      const locale = await getServerLocale();
      if (!session) {
        return Response.json({ error: t("apiServersDetectOs.unauthorized", locale) }, { status: 401 });
      }
      if (!sessionHasPermission(session, "server:ssh")) {
        return Response.json({ error: t("apiServersDetectOs.missingSshPermission", locale) }, { status: 403 });
      }

      const teamAccess = await assertServerTeamAccess(session, id);
      if (!teamAccess.ok) return teamAccess.response;

      const server = await loadServer(id);
      if (!server) {
        return Response.json({ error: t("apiServersDetectOs.serverNotFound", locale) }, { status: 404 });
      }

      try {
        const sshParams = await buildSshParamsFromServer(server, server.sshKey);
        // Single SSH probe path (detectOsDialect already handles os-release + uname fallback).
        const dialect = await detectOsDialect(sshParams);
        const osInfo =
          dialect.distroName && dialect.distroName !== "Unknown (default: Debian)"
            ? dialect.distroName
            : dialect.distroName;
        const fallback =
          dialect.distroName.includes("uname fallback") ||
          dialect.distroName.startsWith("Unknown");

        await prisma.server.update({
          where: { id },
          data: {
            osDialect: serializeDialect(dialect),
            osInfo,
          },
        });

        await auditUserAction(
          session.userId,
          "server.detect_os",
          {
            serverId: id,
            distro: dialect.distroName,
            family: dialect.distroFamily,
            pm: dialect.packageManager,
            sm: dialect.serviceManager,
            fallback,
          },
          "INFO",
          session.currentTeamId,
        );

        return Response.json({
          success: true,
          osInfo,
          dialect: dialectSummary(dialect),
          fallback,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "SSH connection failed";
        logger.warn("OS dialect detection failed", { serverId: id, error: message });
        await auditUserAction(
          session.userId,
          "server.detect_os_error",
          { serverId: id, error: message },
          "WARNING",
          session.currentTeamId,
        );
        return Response.json(
          { error: t("apiServersDetectOs.detectionFailed", locale).replace("{message}", message) },
          { status: 502 },
        );
      }
    },
  );
}
