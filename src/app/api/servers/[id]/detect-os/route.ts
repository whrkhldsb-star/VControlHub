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
 */

import { auditUserAction } from "@/lib/audit/service";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { createLogger } from "@/lib/logging";
import { buildSshParamsFromServer, execRemoteCommand } from "@/lib/ssh/client";
import { detectOsDialect, parseOsRelease, serializeDialect, type OsDialect } from "@/lib/ssh/os-dialect";

export const dynamic = "force-dynamic";
const logger = createLogger("api:servers:detect-os");

type ServerRow = {
  id: string;
  host: string;
  port: number;
  username: string;
  sshKeyId: string | null;
  password: string | null;
  sshKey: { privateKey: string } | null;
};

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
      sshKey: { select: { privateKey: true } },
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

      const server = await loadServer(id);
      if (!server) {
        return Response.json({ error: t("apiServersDetectOs.serverNotFound", locale) }, { status: 404 });
      }

      try {
        // Step 1: 探测 /etc/os-release 原文
        const sshParams = await buildSshParamsFromServer(server, server.sshKey);
        const { stdout, exitCode } = await execRemoteCommand({
          ...sshParams,
          command: "cat /etc/os-release 2>/dev/null",
          timeout: 10_000,
        });

        if (exitCode !== 0 || !stdout.trim()) {
          // Fallback: uname
          const { stdout: unameOut } = await execRemoteCommand({
            ...sshParams,
            command: "uname -s -r -m",
            timeout: 10_000,
          });
          const osInfo = `uname: ${unameOut.trim()}`;
          await prisma.server.update({
            where: { id },
            data: { osInfo, osDialect: serializeDialect({ ...await detectOsDialect(sshParams) }) },
          });
          auditUserAction(session.userId, "server.detect_os", { serverId: id, fallback: "uname" }, "INFO");
          return Response.json({ success: true, osInfo, dialect: null, fallback: true });
        }

        // Step 2: 解析 + 匹配方言
        const releaseInfo = parseOsRelease(stdout);
        const dialect: OsDialect = await detectOsDialect(sshParams);
        const osInfo = releaseInfo.prettyName || `${releaseInfo.name} ${releaseInfo.version}`.trim();

        // Step 3: 持久化到 Server 记录
        await prisma.server.update({
          where: { id },
          data: {
            osDialect: serializeDialect(dialect),
            osInfo,
          },
        });

        auditUserAction(
          session.userId,
          "server.detect_os",
          { serverId: id, distro: dialect.distroName, family: dialect.distroFamily, pm: dialect.packageManager, sm: dialect.serviceManager },
          "INFO",
        );

        return Response.json({
          success: true,
          osInfo,
          dialect: {
            packageManager: dialect.packageManager,
            serviceManager: dialect.serviceManager,
            distroName: dialect.distroName,
            distroFamily: dialect.distroFamily,
            detectedAt: dialect.detectedAt,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "SSH connection failed";
        logger.warn("OS dialect detection failed", { serverId: id, error: message });
        auditUserAction(session.userId, "server.detect_os_error", { serverId: id, error: message }, "WARNING");
        return Response.json({ error: t("apiServersDetectOs.detectionFailed", locale).replace("{message}", message) }, { status: 502 });
      }
    },
  );
}
