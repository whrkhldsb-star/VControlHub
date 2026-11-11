/**
 * POST /api/servers/[id]/file-proxy — 在目标服务器上启动/管理文件代理
 * GET  /api/servers/[id]/file-proxy — 获取文件代理状态
 * DELETE /api/servers/[id]/file-proxy — 停止文件代理
 *
 * 实现方式：通过 SSH 在目标服务器上启动一个临时 Python HTTP 服务器
 * 支持直连模式：浏览器直接从目标服务器获取文件内容
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { randomUUID } from "crypto";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import {
  UPLOAD_LIMIT,
  GENERAL_READ_LIMIT,
} from "@/lib/http/rate-limit-presets";
import {
  buildFileProxyScript,
  sanitizeFileProxyOrigin,
} from "@/lib/server/file-proxy-script";
import {
  decryptServerPassword,
  decryptStoredSshKey,
} from "@/lib/ssh/ssh-key-crypto";
import { createVerifiedSshConfig } from "@/lib/ssh/client";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { assertServerTeamAccess } from "@/lib/server/team-access";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { auditUserAction } from "@/lib/audit/service";
import { getErrorMessage } from "@/lib/http/error-message";
import { acquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";

export const dynamic = "force-dynamic";
const FILE_PROXY_TTL_MS = 2 * 60 * 60 * 1000;

type SshExecServer = {
  host: string;
  port: number;
  username: string;
  connectionType: string;
  password: string | null;
  sshKey: { privateKey: string | null; passphrase: string | null } | null;
  hostKeySha256?: string | null;
};

/**
 * The server's own login, as every other SSH path builds it: the key only for
 * key login, unlocked when it has a passphrase. Decrypting the key alone left
 * a passphrase-protected key encrypted, and the proxy could not start.
 */
function sshExecCredentials(server: SshExecServer) {
  if (server.connectionType === "SSH_KEY") {
    const key = decryptStoredSshKey(server.sshKey);
    return key ? { privateKey: key.privateKey, ...(key.passphrase ? { passphrase: key.passphrase } : {}) } : {};
  }
  return server.password ? { password: decryptServerPassword(server.password) } : {};
}

const SSH_EXEC_TIMEOUT_MS = 15_000;

/**
 * A stored pid names the proxy only while the proxy lives. Once it has exited
 * (a reboot, a kill by hand) the number is free for any other process, and the
 * row keeps it. So nothing trusts the number alone: every check and every
 * signal first reads the process's command line and goes on only when it is
 * this route's script (`python3 /tmp/.vps_file_proxy_<id>.py`; the file is
 * removed after the start, the command line keeps its name). `tr` rather than
 * `grep -a`: BusyBox grep has no -a.
 */
function isProxyProcess(pid: number) {
  return `tr '\\0' ' ' < /proc/${pid}/cmdline 2>/dev/null | grep -q '.vps_file_proxy_'`;
}

/** Prints `proxy_running` when `pid` is the proxy, `not_running` otherwise. */
function proxyLivenessCommand(pid: number) {
  return `${isProxyProcess(pid)} && echo proxy_running || echo not_running`;
}

/** Ends the proxy if `pid` still is one, and removes what a start may have left. */
function proxyStopCommand(pid: number) {
  return `if ${isProxyProcess(pid)}; then kill ${pid} 2>/dev/null; fi; rm -f /tmp/.vps_file_proxy_*.py /tmp/.vps_file_proxy_*.out /tmp/.vps_proxy_out`;
}

function proxyIsLive(result: { stdout: string; exitCode: number }) {
  return result.exitCode === 0 && result.stdout.trim() === "proxy_running";
}

// Execute a remote command with an independent command deadline. SSH
// readyTimeout only covers authentication; a remote `ps`, `tail`, or shell
// command can otherwise keep the HTTP request open indefinitely.
async function sshExec(
  server: SshExecServer,
  command: string,
): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut?: boolean }> {
  const { Client } = await import("ssh2");
  const sshClient = new Client();

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let commandStream: { destroy?: () => void } | null = null;
    let timeout: NodeJS.Timeout | null = null;

    const finish = (result: { stdout: string; stderr: string; exitCode: number; timedOut?: boolean }) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      try {
        commandStream?.destroy?.();
      } catch {
        // The stream may already be closed.
      }
      try {
        sshClient.end();
      } catch {
        // Connection teardown is best-effort after the result is decided.
      }
      resolve(result);
    };

    const config = createVerifiedSshConfig({
      host: server.host,
      port: server.port,
      username: server.username,
      hostKeySha256: server.hostKeySha256,
      // Fail closed on unpinned servers, matching the terminal and command
      // channels: this path decrypts and sends the stored login credential,
      // so a TOFU accept would leak it to an on-path impersonator.
      enforceHostKeyPin: true,
      ...sshExecCredentials(server),
    });
    config.readyTimeout = 10000;
    config.timeout = 10000;
    timeout = setTimeout(() => {
      finish({
        stdout,
        stderr: `${stderr}\nRemote command exceeded ${SSH_EXEC_TIMEOUT_MS}ms and was terminated.`,
        exitCode: 124,
        timedOut: true,
      });
    }, SSH_EXEC_TIMEOUT_MS);

    sshClient.on("ready", () => {
      sshClient.exec(command, { pty: false }, (err, stream) => {
        if (err) {
          finish({ stdout, stderr: err.message, exitCode: -1 });
          return;
        }

        commandStream = stream as unknown as { destroy?: () => void };
        stream.on("data", (data: Buffer) => {
          stdout += data.toString();
        });
        stream.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });
        stream.on("close", (code: number) => {
          finish({ stdout, stderr, exitCode: code });
        });
      });
    });

    sshClient.on("error", (err) => {
      finish({ stdout, stderr: err.message, exitCode: -1 });
    });

    sshClient.connect(config);
  });
}

// ── GET: 获取文件代理状态 ────────────────────────────────

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const locale = await getServerLocale();
  return withApiRoute(
    request,
    {
      permission: "server:ssh",
      // Polling status can SSH `ps -p` each call — bound fan-out (POST/DELETE already use UPLOAD_LIMIT).
      rateLimit: GENERAL_READ_LIMIT,
      errorMessage: t("apiServersFileProxy.getErrorMessage", locale),
    },
    async ({ session }) => {
      const { id } = await params;

      // The returned token serves the entire bound storage root. Path-scoped
      // file grants cannot constrain it, so only node managers may receive it.
      if (!sessionHasPermission(session, "storage:manage-node")) {
        throw new ForbiddenError(t("backend.storageHardening.access.noPermission", locale));
      }

      const teamAccess = await assertServerTeamAccess(session, id, "connect");
      if (!teamAccess.ok) return teamAccess.response;
      const fileAccess = await assertServerTeamAccess(session, id, "fileRead");
      if (!fileAccess.ok) return fileAccess.response;

      const server = await prisma.server.findUnique({
        where: { id },
        include: { sshKey: true },
      });

      if (!server) {
        throw new NotFoundError(t("apiServersFileProxy.serverNotFound", locale));
      }

      const proxy = await prisma.serverFileProxy.findUnique({
        where: {
          serverId_proxyType: { serverId: id, proxyType: "python_http" },
        },
      });

      if (!proxy) {
        return NextResponse.json({ status: "stopped", proxy: null });
      }

      const expired =
        !proxy.expiresAt || proxy.expiresAt.getTime() <= Date.now();
      // Whether the proxy itself is still there (not merely some process with its old number).
      const isRunning =
        !expired &&
        proxy.pid !== null &&
        proxyIsLive(await sshExec(server, proxyLivenessCommand(proxy.pid)));

      // Once, at expiry: the entry is marked stopped below, and a stopped
      // entry is left alone (this ran on every status call, for good).
      if (expired && proxy.pid && proxy.status === "running") {
        await sshExec(server, proxyStopCommand(proxy.pid));
      }

      if ((!isRunning || expired) && proxy.status === "running") {
        // 更新状态为已停止
        await prisma.serverFileProxy.update({
          where: { id: proxy.id },
          data: { status: "stopped" },
        });
      }

      return NextResponse.json({
        status: isRunning ? proxy.status : "stopped",
        proxy: isRunning
          ? {
              id: proxy.id,
              port: proxy.port,
              accessToken: proxy.accessToken,
              publicUrl: server.publicUrl,
              expiresAt: proxy.expiresAt,
            }
          : null,
      });
    },
  );
}

// ── POST: 启动文件代理 ───────────────────────────────────

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const locale = await getServerLocale();
  return withApiRoute(
    request,
    { permission: "server:ssh", rateLimit: UPLOAD_LIMIT, errorMessage: t("apiServersFileProxy.startErrorMessage", locale) },
    async ({ session }) => {
      const { id } = await params;
      if (!sessionHasPermission(session, "storage:manage-node")) {
        throw new ForbiddenError(t("backend.storageHardening.access.noPermission", locale));
      }
      const teamAccessPost = await assertServerTeamAccess(session, id, "manage");
      if (!teamAccessPost.ok) return teamAccessPost.response;
      const connectAccess = await assertServerTeamAccess(session, id, "connect");
      if (!connectAccess.ok) return connectAccess.response;
      const fileAccess = await assertServerTeamAccess(session, id, "fileRead");
      if (!fileAccess.ok) return fileAccess.response;
      let releaseStartLock: (() => Promise<void>) | null = null;
      let rollbackRemoteStart: (() => Promise<void>) | null = null;
      try {
        const server = await prisma.server.findUnique({
          where: { id },
          include: { sshKey: true, storageNode: true },
        });

        if (!server) {
          throw new NotFoundError(t("apiServersFileProxy.serverNotFound", locale));
        }

        if (!server.publicUrl) {
          return NextResponse.json(
            { error: t("apiServersFileProxy.missingPublicUrl", locale) },
            { status: 400 },
          );
        }

        const serveDir = server.storageNode?.basePath?.trim();
        if (!serveDir) {
          return NextResponse.json(
            { error: t("apiServersFileProxy.missingStorageNode", locale) },
            { status: 400 },
          );
        }

        releaseStartLock = await acquireAdvisoryLock("server-file-proxy-start", id);

        // 检查是否已有代理在运行
        const existing = await prisma.serverFileProxy.findUnique({
          where: {
            serverId_proxyType: { serverId: id, proxyType: "python_http" },
          },
        });

        if (existing && existing.status === "running" && existing.pid !== null) {
          // 检查是否真的在运行
          if (proxyIsLive(await sshExec(server, proxyLivenessCommand(existing.pid)))) {
            return NextResponse.json({
              status: "running",
              proxy: {
                id: existing.id,
                port: existing.port,
                accessToken: existing.accessToken,
                publicUrl: server.publicUrl,
                expiresAt: existing.expiresAt,
              },
            });
          }
        }

        // 选择一个可用端口（从 fileProxyPort 或随机）
        const desiredPort = server.fileProxyPort || 0;
        const accessToken = randomUUID();
        const expiresAt = new Date(Date.now() + FILE_PROXY_TTL_MS);
        const expiresAtMs = expiresAt.getTime();

        // 生成启动脚本：Python HTTP 服务器 + header token 验证 + 绑定存储根目录
        const proxyScript = buildFileProxyScript({
          accessToken,
          expiresAtMs,
          serveDir,
          port: desiredPort || 0,
          allowedOrigin: sanitizeFileProxyOrigin(request.headers.get("origin")),
        });

        // 写入脚本并启动
        const runId = randomUUID().replace(/-/g, "");
        const remoteScriptPath = `/tmp/.vps_file_proxy_${runId}.py`;
        const remoteOutputPath = `/tmp/.vps_file_proxy_${runId}.out`;
        const startCmd = `cat > ${remoteScriptPath} << 'PROXYEOF'\n${proxyScript}\nPROXYEOF\nnohup python3 ${remoteScriptPath} > ${remoteOutputPath} 2>&1 & echo $!`;

        const result = await sshExec(
          server,
          startCmd,
        );

        const pid = parseInt(result.stdout.trim(), 10);
        if (isNaN(pid) || pid <= 0) {
          await sshExec(
            server,
            `rm -f ${remoteScriptPath} ${remoteOutputPath}`,
          ).catch(() => undefined);
          return NextResponse.json(
            { error: t("apiServersFileProxy.startFailed", locale), details: result.stderr },
            { status: 500 },
          );
        }

        rollbackRemoteStart = async () => {
          await sshExec(
            server,
            `kill ${pid} 2>/dev/null; rm -f ${remoteScriptPath} ${remoteOutputPath}`,
          );
        };

        // 轮询等待代理启动并读取实际端口。固定 sleep + 单次读取在慢 VPS 上
        // 会把"就绪慢"误报为失败(重试还会叠加孤儿 python3 进程); 且当
        // fileProxyPort 已配置但绑定失败时, 回落 desiredPort 会把已崩溃的
        // 代理记为 running(假成功)。这里必须等到 PROXY_READY 或显式失败。
        const PROXY_READY_POLL_MS = 500;
        const PROXY_READY_TIMEOUT_MS = 10_000;
        let actualPort = 0;
        let lastOut = "";
        const readyDeadline = Date.now() + PROXY_READY_TIMEOUT_MS;
        while (Date.now() < readyDeadline) {
          const portResult = await sshExec(
            server,
            `tail -n 20 ${remoteOutputPath} 2>/dev/null || true; kill -0 ${pid} 2>/dev/null || echo "__PROXY_EXITED__"`,
          );
          lastOut = portResult.stdout;
          if (lastOut.includes("__PROXY_EXITED__")) break;
          const portMatch = lastOut.match(/PROXY_READY:(\d+)/);
          if (portMatch) {
            actualPort = parseInt(portMatch[1]!, 10);
            break;
          }
          await new Promise((r) => setTimeout(r, PROXY_READY_POLL_MS));
        }

        if (!actualPort) {
          await rollbackRemoteStart().catch(() => undefined);
          rollbackRemoteStart = null;
          const detail = lastOut
            .replace("__PROXY_EXITED__", "")
            .trim()
            .slice(-400) || "(no proxy output yet)";
          return NextResponse.json(
            { error: t("apiServersFileProxy.startTimeout", locale), details: detail },
            { status: 502 },
          );
        }

        // 保存到数据库
        const proxy = await prisma.serverFileProxy.upsert({
          where: {
            serverId_proxyType: { serverId: id, proxyType: "python_http" },
          },
          create: {
            serverId: id,
            proxyType: "python_http",
            port: actualPort,
            status: "running",
            pid,
            accessToken,
            expiresAt,
          },
          update: {
            port: actualPort,
            status: "running",
            pid,
            accessToken,
            expiresAt,
          },
        });
        rollbackRemoteStart = null;
        await sshExec(
          server,
          `rm -f ${remoteScriptPath} ${remoteOutputPath}`,
        ).catch(() => undefined);

        await auditUserAction(
          session.userId,
          "server.file_proxy.start",
          {
            serverId: id,
            proxyId: proxy.id,
            port: actualPort,
            expiresAt: expiresAt.toISOString(),
          },
          undefined,
          session.currentTeamId,
        );

        return NextResponse.json({
          status: "running",
          proxy: {
            id: proxy.id,
            port: actualPort,
            accessToken,
            publicUrl: server.publicUrl,
            expiresAt,
          },
        });
      } catch (error) {
        await rollbackRemoteStart?.().catch(() => undefined);
        const msg = getErrorMessage(error, t("apiServersFileProxy.operationFailed", locale));
        throw new AppError({ code: "INTERNAL_ERROR", message: msg, status: 500 });
      } finally {
        await releaseStartLock?.();
      }
    },
  );
}

// ── DELETE: 停止文件代理 ─────────────────────────────────

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const locale = await getServerLocale();
  return withApiRoute(
    request,
    { permission: "server:ssh", rateLimit: UPLOAD_LIMIT, errorMessage: t("apiServersFileProxy.stopErrorMessage", locale) },
    async ({ session }) => {
      const { id } = await params;
      if (!sessionHasPermission(session, "storage:manage-node")) {
        throw new ForbiddenError(t("backend.storageHardening.access.noPermission", locale));
      }
      const teamAccessDelete = await assertServerTeamAccess(session, id, "manage");
      if (!teamAccessDelete.ok) return teamAccessDelete.response;
      const connectAccess = await assertServerTeamAccess(session, id, "connect");
      if (!connectAccess.ok) return connectAccess.response;
      try {
        const proxy = await prisma.serverFileProxy.findUnique({
          where: {
            serverId_proxyType: { serverId: id, proxyType: "python_http" },
          },
        });

        if (!proxy) {
          return NextResponse.json({ status: "stopped" });
        }

        // 终止远程进程
        const server = await prisma.server.findUnique({
          where: { id },
          include: { sshKey: true, storageNode: true },
        });

        // Whatever the entry says: a proxy that is still alive is stopped, and
        // a number that now belongs to another process is not signalled.
        if (server && proxy.pid) {
          await sshExec(server, proxyStopCommand(proxy.pid));
        }

        await prisma.serverFileProxy.update({
          where: { id: proxy.id },
          data: { status: "stopped" },
        });

        await auditUserAction(
          session.userId,
          "server.file_proxy.stop",
          { serverId: id, proxyId: proxy.id, pid: proxy.pid },
          undefined,
          session.currentTeamId,
        );

        return NextResponse.json({ status: "stopped" });
      } catch (error) {
        const msg = getErrorMessage(error, t("apiServersFileProxy.operationFailed", locale));
        throw new AppError({ code: "INTERNAL_ERROR", message: msg, status: 500 });
      }
    },
  );
}
