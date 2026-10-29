/**
 * POST /api/servers/[id]/reload — 在目标服务器上触发服务重载 / 重启
 *
 * TR-012 T17b: 配合 SFTP 文本编辑器（text-preview-client）使用，
 * 用户编辑完 nginx.conf / sshd_config / redis.conf 等配置并保存后，
 * 浏览器再调用本接口在对应服务器上执行 `systemctl reload <unit>`
 * （或对 docker compose 触发 `docker compose up -d`），让配置立刻生效，
 * 不必登 SSH 手动操作。
 *
 * 设计边界：
 * 1. **unit 名字白名单**：只接受字母数字、`.`、`-`、`_`，最长 128 字符；
 *    拒绝 `;` `|` `&` `$` `` ` `` `\\` 等任何 shell 元字符。
 * 2. **systemd** 与 **compose** 两种 kind，前者拼 `systemctl reload <unit>`，
 *    后者需要 projectDir（`docker compose up -d` 在哪个目录运行）。
 * 3. **执行失败 ≠ HTTP 5xx**：远端 systemctl exit=1 是用户操作的结果，
 *    应当返回 200 + `{ success: false, exitCode, stderr, ... }`。
 *    只有网络 / SSH 握手失败才 5xx。
 * 4. **审计**：所有成功 / 失败 / 拒绝的调用都写入 AuditLog（fire-and-forget）。
 * 5. **超时**：systemd 30s / compose 120s。远端进程在 SSH 内 client.end() 强制断开。
 */

import path from "node:path";

import { z } from "zod";

import { auditUserAction } from "@/lib/audit/service";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { createLogger } from "@/lib/logging";
import { buildSshParamsFromServer, execRemoteCommand } from "@/lib/ssh/client";
import { deserializeDialect, serviceCommand, type OsDialect } from "@/lib/ssh/os-dialect";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { assertServerTeamAccess } from "@/lib/server/team-access";
import { getErrorMessage } from "@/lib/http/error-message";
import { getStorageFileNode } from "@/lib/storage/file-content";
import { normalizeRemoteTargetPath } from "@/lib/storage/remote-path";
import { shellQuote } from "@/lib/shell-quote";
import { SSH_CONNECTION_SERVER_SELECT } from "@/lib/ssh/server-connection-select";

export const dynamic = "force-dynamic";
const logger = createLogger("api:servers:reload");

/**
 * 单元名字允许的字符集：字母、数字、`.`、`-`、`_`、`@`。
 * 显式拒绝 shell 元字符与路径分隔符（避免注入）。
 */
const UNIT_NAME_PATTERN = /^[A-Za-z0-9._@-]{1,128}$/;

/**
 * compose kind 需要的 projectDir 同样收严：只允许常见 Linux 路径字符，
 * 长度 1-256，且必须以 `/` 开头（绝对路径）。
 */
const PROJECT_DIR_PATTERN = /^\/[A-Za-z0-9._\-/]{0,255}$/;

const reloadBodySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("systemd"),
    unit: z.string().regex(UNIT_NAME_PATTERN, t("apiServersReload.unitNamePatternError", "zh")),
  }),
  z.object({
    kind: z.literal("compose"),
    projectDir: z.string().regex(PROJECT_DIR_PATTERN, t("apiServersReload.projectDirPatternError", "zh")).optional(),
    /**
     * The compose file, as the storage node knows it. A node's paths are relative to its root (/root/drive for the
     * node of a server), not to the server's: the browser used to send "/" + that relative folder as the project
     * directory, which does not exist, or is another project's. The server resolves it against the node's root.
     */
    composeFile: z.object({
      storageNodeId: z.string().min(1).max(128),
      relativePath: z.string().min(1).max(2048),
    }).optional(),
    /** 可选的 compose 服务名，缺省则 up 整个项目 */
    service: z.string().regex(UNIT_NAME_PATTERN).optional(),
  }),
]);

type ReloadBody = z.infer<typeof reloadBodySchema>;

function buildCommand(body: ReloadBody, dialect: OsDialect, composeProjectDir = ""): string {
  if (body.kind === "systemd") {
    // TR-041: 使用方言感知的 serviceCommand 替代硬编码 systemctl
    // systemd kind 始终用 reload → fallback restart 语义
    if (dialect.serviceManager === "systemd") {
      return serviceCommand("systemd", "reload", body.unit, dialect.sudoPattern);
    }
    // 非 systemd（openrc/sysvinit）不支持 reload 语义，直接 restart
    return serviceCommand(dialect.serviceManager, "restart", body.unit, dialect.sudoPattern);
  }
  // A resolved directory may hold spaces or other characters a shell reads: quoted unless it is plainly safe.
  const cd = `cd ${/^[A-Za-z0-9._/-]+$/.test(composeProjectDir) ? composeProjectDir : `-- ${shellQuote(composeProjectDir)}`}`;
  const up = body.service
    ? `docker compose up -d ${body.service.replace(/'/g, "'\\''")}`
    : "docker compose up -d";
  return `${cd} && ${up}`;
}

function timeoutFor(body: ReloadBody): number {
  return body.kind === "compose" ? 120_000 : 30_000;
}

type ServerRow = {
  id: string;
  host: string;
  port: number;
  username: string;
  operatingSystem: string;
  connectionType: string;
  managementMode: string;
  sshKeyId: string | null;
  password: string | null;
  hostKeySha256: string | null;
  sshKey: { privateKey: string; passphrase: string | null } | null;
  osDialect: string | null;
};

async function loadServer(id: string): Promise<ServerRow | null> {
  const server = await prisma.server.findUnique({
    where: { id },
    // The whole connection (see SSH_CONNECTION_SERVER_SELECT).
    select: { ...SSH_CONNECTION_SERVER_SELECT, osDialect: true },
  });
  return (server as ServerRow | null) ?? null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withApiRoute(
    request,
    {
      // Reload/compose requires SSH on the target host — gate on server:ssh (not write-only).
      permission: "server:ssh",
      rateLimit: GENERAL_WRITE_LIMIT,
      bodySchema: reloadBodySchema,
      // errorMessage is filled inside the route callback after getServerLocale resolves.
      errorMessage: t("apiServersReload.errorMessage", "zh"),
    },
    async ({ session, body }) => {
      const locale = await getServerLocale();

      const teamAccess = await assertServerTeamAccess(session, id, "manage");
      if (!teamAccess.ok) return teamAccess.response;

      const server = await loadServer(id);
      if (!server) {
        return Response.json({ error: t("apiServersReload.serverNotFound", locale) }, { status: 404 });
      }

      let composeProjectDir = "";
      if (body.kind === "compose") {
        if (body.composeFile) {
          const node = await getStorageFileNode(body.composeFile.storageNodeId, session);
          if (!node || node.serverId !== id || node.driver !== "SFTP") {
            return Response.json({ error: t("apiServersReload.serverNotFound", locale) }, { status: 404 });
          }
          try {
            const file = normalizeRemoteTargetPath(node.basePath, body.composeFile.relativePath);
            composeProjectDir = path.posix.dirname(file);
          } catch {
            return Response.json({ error: t("apiServersReload.projectDirPatternError", locale) }, { status: 400 });
          }
          if (/[\u0000-\u001f\u007f]/.test(composeProjectDir)) {
            return Response.json({ error: t("apiServersReload.projectDirPatternError", locale) }, { status: 400 });
          }
        } else if (body.projectDir) {
          composeProjectDir = body.projectDir;
        } else {
          return Response.json({ error: t("apiServersReload.projectDirPatternError", locale) }, { status: 400 });
        }
      }

      const dialect = deserializeDialect(server.osDialect);
      const command = buildCommand(body, dialect, composeProjectDir);
      const commandTimeout = timeoutFor(body);

      // audit 前置记录 (input 摘要，不含密码 / 完整密钥)
      const auditBase = {
        serverId: id,
        kind: body.kind,
        ...(body.kind === "systemd"
          ? { unit: body.unit }
          : { projectDir: composeProjectDir, service: body.service ?? null }),
      };

      try {
        const sshParams = await buildSshParamsFromServer(server, server.sshKey);
        const { stdout, stderr, exitCode } = await execRemoteCommand({
          ...sshParams,
          command,
          timeout: commandTimeout,
        });

        const success = exitCode === 0;
        await auditUserAction(
          session.userId,
          success ? "server.reload_ok" : "server.reload_failed",
          { ...auditBase, exitCode: exitCode ?? -1, stdoutBytes: stdout.length, stderrBytes: stderr.length },
          success ? "INFO" : "WARNING",
          session.currentTeamId,
        );

        return Response.json({
          success,
          exitCode,
          stdout,
          stderr,
          command,
        });
      } catch (error) {
        const message = getErrorMessage(error, t("apiServersReload.remoteExecutionFailed", locale));
        logger.warn("server reload raised", { serverId: id, error: message });
        await auditUserAction(
          session.userId,
          "server.reload_error",
          { ...auditBase, error: message },
          "CRITICAL",
          session.currentTeamId,
        );
        return Response.json(
          { error: t("apiServersReload.reloadFailedWithMessage", locale, { message }), command },
          { status: 502 },
        );
      }
    },
  );
}
