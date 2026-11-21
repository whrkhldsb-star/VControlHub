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
import { prisma } from "@/lib/db";
import { probeEndpointWhere } from "@/lib/server/service-profile-includes";
import { ConflictError } from "@/lib/errors";
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
import { getErrorMessage } from "@/lib/http/error-message";
import { SSH_CONNECTION_SERVER_SELECT } from "@/lib/ssh/server-connection-select";

export const dynamic = "force-dynamic";
const logger = createLogger("api:servers:detect-os");

function dialectSummary(dialect: OsDialect) {
  return {
    packageManager: dialect.packageManager,
    serviceManager: dialect.serviceManager,
    distroName: dialect.distroName,
    distroFamily: dialect.distroFamily,
    detectedAt: dialect.detectedAt,
  };
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withApiRoute(
    _request,
    {
      permission: "server:ssh",
      rateLimit: GENERAL_WRITE_LIMIT,
    },
    async ({ session }) => {
      const locale = await getServerLocale();

      const teamAccess = await assertServerTeamAccess(session, id, "connect");
      if (!teamAccess.ok) return teamAccess.response;

      const server = await prisma.server.findUnique({
        where: { id, teamId: teamAccess.server.teamId, enabled: true },
        select: SSH_CONNECTION_SERVER_SELECT,
      });
      if (!server) {
        return Response.json({ error: t("apiServersDetectOs.serverNotFound", locale) }, { status: 404 });
      }
      // The probe reads os-release / uname: on Windows it stored an
      // "Unknown" dialect over the node's details.
      if (server.operatingSystem === "WINDOWS") {
        return Response.json({ error: t("backend.server.linuxOnly", locale) }, { status: 400 });
      }

      try {
        const sshParams = await buildSshParamsFromServer(server, server.sshKey);
        // Single SSH probe path (detectOsDialect already handles os-release + uname fallback).
        const dialect = await detectOsDialect(sshParams);
        const osInfo = dialect.distroName;
        const fallback =
          dialect.distroName.includes("uname fallback") ||
          dialect.distroName.startsWith("Unknown");

        const saved = await prisma.server.updateMany({
          where: probeEndpointWhere(server, true),
          data: {
            osDialect: serializeDialect(dialect),
            osInfo,
          },
        });
        if (saved.count === 0) {
          throw new ConflictError(t("apiServersDetectOs.serverChanged", locale));
        }

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
        const message = getErrorMessage(error, "SSH connection failed");
        logger.warn("OS dialect detection failed", { serverId: id, error: message });
        await auditUserAction(
          session.userId,
          "server.detect_os_error",
          { serverId: id, error: message },
          "WARNING",
          session.currentTeamId,
        );
        if (error instanceof ConflictError) throw error;
        return Response.json(
          { error: t("apiServersDetectOs.detectionFailed", locale, { message }) },
          { status: 502 },
        );
      }
    },
  );
}
