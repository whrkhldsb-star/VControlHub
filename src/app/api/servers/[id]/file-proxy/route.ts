/**
 * POST /api/servers/[id]/file-proxy — 在目标服务器上启动/管理文件代理
 * GET  /api/servers/[id]/file-proxy — 获取文件代理状态
 * DELETE /api/servers/[id]/file-proxy — 停止文件代理
 *
 * 实现方式：通过 SSH 在目标服务器上启动一个临时 Python HTTP 服务器
 * 支持直连模式：浏览器直接从目标服务器获取文件内容
 */

import { NextResponse } from "next/server";
import type { ServerFileProxy } from "@prisma/client";
import type { SessionPayload } from "@/lib/auth/session";
import { isServerStorageEndpoint } from "@/lib/server/storage-endpoint";
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
  fileProxyProcessCommand,
  startFileProxyCommand,
  sanitizeFileProxyOrigin,
} from "@/lib/server/file-proxy-script";
import {
  decryptServerPassword,
  decryptStoredSshKey,
} from "@/lib/ssh/ssh-key-crypto";
import { createVerifiedSshConfig } from "@/lib/ssh/client";
import { getServerLocale, t, type Locale } from "@/lib/i18n/translations";
import { assertServerTeamAccess } from "@/lib/server/team-access";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { auditUserAction } from "@/lib/audit/service";
import { acquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";

export const dynamic = "force-dynamic";
const FILE_PROXY_TTL_MS = 2 * 60 * 60 * 1000;

type SshExecServer = {
  teamId: string | null;
  host: string;
  port: number;
  username: string;
  connectionType: string;
  password: string | null;
  sshKey: { teamId: string | null; privateKey: string | null; passphrase: string | null } | null;
  hostKeySha256?: string | null;
};

/**
 * The server's own login, as every other SSH path builds it: the key only for
 * key login, unlocked when it has a passphrase. Decrypting the key alone left
 * a passphrase-protected key encrypted, and the proxy could not start.
 */
function sshExecCredentials(server: SshExecServer) {
  if (server.connectionType === "SSH_KEY") {
    const key = decryptStoredSshKey(server.sshKey, server.teamId);
    return key ? { privateKey: key.privateKey, ...(key.passphrase ? { passphrase: key.passphrase } : {}) } : {};
  }
  return server.password ? { password: decryptServerPassword(server.password) } : {};
}

const SSH_EXEC_TIMEOUT_MS = 15_000;

// Execute a remote command with an independent command deadline. SSH
// readyTimeout only covers authentication; a remote `ps`, `tail`, or shell
// command can otherwise keep the HTTP request open indefinitely.
async function sshExec(
  server: SshExecServer,
  command: string,
  stdin?: string,
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
        stream.end(stdin);
      });
    });

    sshClient.on("error", (err) => {
      finish({ stdout, stderr: err.message, exitCode: -1 });
    });

    sshClient.connect(config);
  });
}

function loadProxyServer(id: string, teamId: string | null, cleanup: boolean) {
  return prisma.server.findUnique({ where: { id, teamId, ...(cleanup ? {} : { enabled: true }) }, include: { sshKey: true, storageNode: true } });
}

type ProxyServer = NonNullable<Awaited<ReturnType<typeof loadProxyServer>>>;

async function withProxyServer(
  session: SessionPayload, id: string, locale: Locale, method: "GET" | "POST" | "DELETE",
  work: (server: ProxyServer, proxy: ServerFileProxy | null) => Promise<Response>,
) {
  if (!sessionHasPermission(session, "storage:manage-node")) {
    throw new ForbiddenError(t("backend.storageHardening.access.noPermission", locale));
  }
  const access = await assertServerTeamAccess(session, id, method === "GET" ? "fileRead" : "manage");
  if (!access.ok) return access.response;
  const connect = await assertServerTeamAccess(session, id, "connect");
  if (!connect.ok) return connect.response;
  if (method === "POST") {
    const read = await assertServerTeamAccess(session, id, "fileRead");
    if (!read.ok) return read.response;
  }

  // Transfer holds this lock through commit. A caller who waited for a transfer
  // can no longer load the credentials or proxy token under the former customer.
  const release = await acquireAdvisoryLock("server-delete", id);
  try {
    const server = await loadProxyServer(id, access.server.teamId, method === "DELETE");
    if (!server) throw new NotFoundError(t("apiServersFileProxy.serverNotFound", locale));
    const proxy = await prisma.serverFileProxy.findUnique({
      where: { serverId_proxyType: { serverId: id, proxyType: "python_http" } },
    });
    return await work(server, proxy);
  } finally {
    await release();
  }
}

function requireProxyRoot(server: ProxyServer, locale: Locale) {
  const node = server.storageNode;
  if (node?.driver !== "SFTP" || !node.basePath.trim()) {
    throw new AppError({ code: "VALIDATION_FAILED", status: 400, message: t("apiServersFileProxy.missingStorageNode", locale) });
  }
  // The temporary Python proxy runs through the server's Linux shell.
  if (server.operatingSystem === "WINDOWS" || !isServerStorageEndpoint(server, node)) {
    throw new AppError({ code: "VALIDATION_FAILED", status: 400, message: t("apiServersFileProxy.endpointMismatch", locale) });
  }
  return node.basePath.trim();
}

function proxyMayBeActive(proxy: ServerFileProxy) {
  // Older releases could mark a failed SSH stop as successful, leaving the PID and token behind.
  return proxy.status !== "stopped" || proxy.pid !== null || (proxy.accessToken !== null
    && (!proxy.expiresAt || proxy.expiresAt.getTime() > Date.now()));
}

async function checkProxyProcess(server: ProxyServer, pid: number | null, stop: boolean, locale: Locale) {
  const result = pid === null ? null : await sshExec(server, fileProxyProcessCommand(pid, stop));
  if (result?.exitCode === 0) {
    if (result.stdout.trim() === "not_running") return false;
    if (result.stdout.trim() === "proxy_running") {
      if (!stop) return true;
      throw new AppError({ code: "CONFLICT", status: 409, message: t("apiServersFileProxy.stillRunning", locale) });
    }
  }
  throw new AppError({ code: "INTERNAL_ERROR", status: 502, message: t("apiServersFileProxy.unknownStatus", locale) });
}

function markStopped(id: string) {
  return prisma.serverFileProxy.update({
    where: { id }, data: { status: "stopped", pid: null, accessToken: null, expiresAt: null },
  });
}

function runningResponse(server: ProxyServer, proxy: ServerFileProxy) {
  return NextResponse.json({
    status: "running",
    proxy: { id: proxy.id, port: proxy.port, accessToken: proxy.accessToken, publicUrl: server.publicUrl, expiresAt: proxy.expiresAt },
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const locale = await getServerLocale();
  return withApiRoute(request, {
    permission: "server:ssh", rateLimit: GENERAL_READ_LIMIT, errorMessage: t("apiServersFileProxy.getErrorMessage", locale),
  }, async ({ session }) => withProxyServer(session, (await params).id, locale, "GET", async (server, proxy) => {
    if (proxy && proxyMayBeActive(proxy)) {
      const expired = !proxy.expiresAt || proxy.expiresAt.getTime() <= Date.now();
      const running = await checkProxyProcess(server, proxy.pid, expired || proxy.status !== "running", locale);
      if (running) {
        requireProxyRoot(server, locale);
        return runningResponse(server, proxy);
      }
      await markStopped(proxy.id);
    }
    return NextResponse.json({ status: "stopped", proxy: null });
  }));
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const locale = await getServerLocale();
  return withApiRoute(request, {
    permission: "server:ssh", rateLimit: UPLOAD_LIMIT, errorMessage: t("apiServersFileProxy.startErrorMessage", locale),
  }, async ({ session }) => withProxyServer(session, (await params).id, locale, "POST", async (server, existing) => {
    if (!server.publicUrl) {
      return NextResponse.json({ error: t("apiServersFileProxy.missingPublicUrl", locale) }, { status: 400 });
    }
    const serveDir = requireProxyRoot(server, locale);
    if (existing && proxyMayBeActive(existing)) {
      const expired = !existing.expiresAt || existing.expiresAt.getTime() <= Date.now();
      if (await checkProxyProcess(server, existing.pid, expired || existing.status !== "running", locale)) {
        return runningResponse(server, existing);
      }
      await markStopped(existing.id);
    }

    const accessToken = randomUUID();
    const expiresAt = new Date(Date.now() + FILE_PROXY_TTL_MS);
    const script = buildFileProxyScript({
      accessToken, expiresAtMs: expiresAt.getTime(), serveDir, port: server.fileProxyPort,
      allowedOrigin: sanitizeFileProxyOrigin(request.headers.get("origin")),
    });
    const launch = await sshExec(server, startFileProxyCommand, script);
    const process = /^(\d+) (\/tmp\/\.vps_file_proxy_[a-zA-Z0-9]{10})$/.exec(launch.stdout.trim());
    if (launch.exitCode !== 0 || !process || !Number.isSafeInteger(Number(process[1])) || Number(process[1]) <= 0) {
      throw new AppError({ code: "INTERNAL_ERROR", status: 502, message: t("apiServersFileProxy.startFailed", locale) });
    }
    const pid = Number(process[1]);
    const dir = process[2];
    const data = { pid, accessToken, expiresAt, status: "starting", port: 0 };
    // The remote process times out without serving unless we record its PID
    // first. This also makes a crash between release and readiness recoverable.
    const proxy = await prisma.serverFileProxy.upsert({
      where: { serverId_proxyType: { serverId: server.id, proxyType: "python_http" } },
      create: { serverId: server.id, proxyType: "python_http", ...data }, update: data,
    });
    try {
      const ready = await sshExec(server, `set -eu
touch ${dir}/start
i=0
while [ "$i" -lt 50 ]; do
  kill -0 ${pid} || exit 1
  if grep '^PROXY_READY:[0-9][0-9]*$' ${dir}/proxy.out; then exit 0; fi
  sleep 0.2
  i=$((i+1))
done
exit 1`);
      const port = Number(/^PROXY_READY:(\d+)$/.exec(ready.stdout.trim())?.[1]);
      if (ready.exitCode !== 0 || !Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new AppError({ code: "INTERNAL_ERROR", status: 502, message: t("apiServersFileProxy.startTimeout", locale) });
      }
      await prisma.serverFileProxy.update({ where: { id: proxy.id }, data: { port, status: "running" } });
      await auditUserAction(session.userId, "server.file_proxy.start", {
        serverId: server.id, proxyId: proxy.id, port, expiresAt: expiresAt.toISOString(),
      }, undefined, session.currentTeamId);
      return runningResponse(server, { ...proxy, ...data, port });
    } catch (error) {
      await checkProxyProcess(server, pid, true, locale);
      await markStopped(proxy.id);
      throw error;
    } finally {
      await sshExec(server, `rm -f ${dir}/start ${dir}/proxy.py ${dir}/proxy.out && rmdir ${dir}`).catch(() => undefined);
    }
  }));
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const locale = await getServerLocale();
  return withApiRoute(request, {
    permission: "server:ssh", rateLimit: UPLOAD_LIMIT, errorMessage: t("apiServersFileProxy.stopErrorMessage", locale),
  }, async ({ session }) => withProxyServer(session, (await params).id, locale, "DELETE", async (server, proxy) => {
    if (proxy && proxyMayBeActive(proxy)) {
      await checkProxyProcess(server, proxy.pid, true, locale);
      await markStopped(proxy.id);
      await auditUserAction(session.userId, "server.file_proxy.stop", {
        serverId: server.id, proxyId: proxy.id, pid: proxy.pid,
      }, undefined, session.currentTeamId);
    }
    return NextResponse.json({ status: "stopped" });
  }));
}
