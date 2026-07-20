/**
 * POST /api/servers/[id]/file-proxy — 在目标服务器上启动/管理文件代理
 * GET  /api/servers/[id]/file-proxy — 获取文件代理状态
 * DELETE /api/servers/[id]/file-proxy — 停止文件代理
 *
 * 实现方式：通过 SSH 在目标服务器上启动一个临时 Python HTTP 服务器
 * 支持直连模式：浏览器直接从目标服务器获取文件内容
 */

import { NextResponse } from "next/server";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { randomUUID } from "crypto";
import { AppError, NotFoundError } from "@/lib/errors";
import {
  withRateLimit,
  rateLimitResponse,
  UPLOAD_LIMIT,
} from "@/lib/http/rate-limit-presets";
import {
  buildFileProxyScript,
  sanitizeFileProxyOrigin,
} from "@/lib/server/file-proxy-script";
import {
  decryptServerPassword,
  decryptSshPrivateKey,
} from "@/lib/ssh/ssh-key-crypto";
import { createVerifiedSshConfig } from "@/lib/ssh/client";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { assertServerTeamAccess } from "@/lib/server/team-access";

export const dynamic = "force-dynamic";
const FILE_PROXY_TTL_MS = 2 * 60 * 60 * 1000;

// 在目标服务器上执行 SSH 命令的辅助函数
async function sshExec(
  server: {
    host: string;
    port: number;
    username: string;
    password: string | null;
    sshKey: { privateKey: string } | null;
    hostKeySha256?: string | null;
  },
  command: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { Client } = await import("ssh2");
  const sshClient = new Client();

  return new Promise((resolve) => {
    const config = createVerifiedSshConfig({
      host: server.host,
      port: server.port,
      username: server.username,
      hostKeySha256: server.hostKeySha256,
      ...(server.sshKey?.privateKey
        ? { privateKey: decryptSshPrivateKey(server.sshKey.privateKey) }
        : server.password
          ? { password: decryptServerPassword(server.password) }
          : {}),
    });
    config.readyTimeout = 10000;

    sshClient.on("ready", () => {
      sshClient.exec(command, { pty: false }, (err, stream) => {
        if (err) {
          sshClient.end();
          resolve({ stdout: "", stderr: err.message, exitCode: -1 });
          return;
        }

        let stdout = "";
        let stderr = "";
        stream.on("data", (data: Buffer) => {
          stdout += data.toString();
        });
        stream.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });
        stream.on("close", (code: number) => {
          sshClient.end();
          resolve({ stdout, stderr, exitCode: code });
        });
      });
    });

    sshClient.on("error", (err) => {
      sshClient.end();
      resolve({ stdout: "", stderr: err.message, exitCode: -1 });
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
    { permission: "server:ssh", errorMessage: t("apiServersFileProxy.getErrorMessage", locale) },
    async ({ session }) => {
      if (!session)
        return NextResponse.json(
          { error: t("apiServersFileProxy.unauthorized", locale) },
          { status: 401 },
        );
      if (!sessionHasPermission(session, "server:ssh")) {
        return NextResponse.json(
          { error: t("apiServersFileProxy.missingSshPermission", locale) },
          { status: 403 },
        );
      }
      const { id } = await params;

      const teamAccess = await assertServerTeamAccess(session, id);
      if (!teamAccess.ok) return teamAccess.response;

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

      // 检查代理进程是否还在运行
      const checkResult = await sshExec(
        server as {
          host: string;
          port: number;
          username: string;
          password: string | null;
          sshKey: { privateKey: string } | null;
    hostKeySha256?: string | null;
        },
        `ps -p ${proxy.pid} -o pid= 2>/dev/null || echo "not_running"`,
      );

      const expired =
        !proxy.expiresAt || proxy.expiresAt.getTime() <= Date.now();
      const isRunning =
        !expired &&
        checkResult.stdout.trim() !== "not_running" &&
        checkResult.exitCode === 0;

      if (expired && proxy.pid) {
        await sshExec(
          server as {
            host: string;
            port: number;
            username: string;
            password: string | null;
            sshKey: { privateKey: string } | null;
    hostKeySha256?: string | null;
          },
          `kill ${proxy.pid} 2>/dev/null; rm -f /tmp/.vps_file_proxy_*.py /tmp/.vps_proxy_out`,
        );
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
  const rl = await withRateLimit(request, UPLOAD_LIMIT);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);
  const locale = await getServerLocale();
  return withApiRoute(
    request,
    { permission: "server:ssh", errorMessage: t("apiServersFileProxy.startErrorMessage", locale) },
    async ({ session }) => {
      if (!session)
        return NextResponse.json(
          { error: t("apiServersFileProxy.unauthorized", locale) },
          { status: 401 },
        );
      if (!sessionHasPermission(session, "server:ssh")) {
        return NextResponse.json(
          { error: t("apiServersFileProxy.missingSshPermission", locale) },
          { status: 403 },
        );
      }
      const { id } = await params;
      const teamAccessPost = await assertServerTeamAccess(session, id);
      if (!teamAccessPost.ok) return teamAccessPost.response;
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

        // 检查是否已有代理在运行
        const existing = await prisma.serverFileProxy.findUnique({
          where: {
            serverId_proxyType: { serverId: id, proxyType: "python_http" },
          },
        });

        if (existing && existing.status === "running") {
          // 检查是否真的在运行
          const check = await sshExec(
            server as {
              host: string;
              port: number;
              username: string;
              password: string | null;
              sshKey: { privateKey: string } | null;
    hostKeySha256?: string | null;
            },
            `ps -p ${existing.pid} -o pid= 2>/dev/null || echo "not_running"`,
          );
          if (check.stdout.trim() !== "not_running" && check.exitCode === 0) {
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
        const remoteScriptPath = `/tmp/.vps_file_proxy_${Date.now()}.py`;
        const startCmd = `cat > ${remoteScriptPath} << 'PROXYEOF'\n${proxyScript}\nPROXYEOF\nnohup python3 ${remoteScriptPath} > /tmp/.vps_proxy_out 2>&1 & echo $!`;

        const result = await sshExec(
          server as {
            host: string;
            port: number;
            username: string;
            password: string | null;
            sshKey: { privateKey: string } | null;
    hostKeySha256?: string | null;
          },
          startCmd,
        );

        const pid = parseInt(result.stdout.trim(), 10);
        if (isNaN(pid) || pid <= 0) {
          return NextResponse.json(
            { error: t("apiServersFileProxy.startFailed", locale), details: result.stderr },
            { status: 500 },
          );
        }

        // 等待代理启动并获取实际端口
        await new Promise((r) => setTimeout(r, 1500));
        const portResult = await sshExec(
          server as {
            host: string;
            port: number;
            username: string;
            password: string | null;
            sshKey: { privateKey: string } | null;
    hostKeySha256?: string | null;
          },
          `cat /tmp/.vps_proxy_out 2>/dev/null | grep "PROXY_READY" | head -1`,
        );

        const portMatch = portResult.stdout.match(/PROXY_READY:(\d+)/);
        const actualPort = portMatch ? parseInt(portMatch[1]!, 10) : desiredPort;

        if (!actualPort) {
          return NextResponse.json(
            { error: t("apiServersFileProxy.cannotDeterminePort", locale) },
            { status: 500 },
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
        const msg = error instanceof Error ? error.message : t("apiServersFileProxy.operationFailed", locale);
        throw new AppError({ code: "INTERNAL_ERROR", message: msg, status: 500 });
      }
    },
  );
}

// ── DELETE: 停止文件代理 ─────────────────────────────────

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const rl = await withRateLimit(request, UPLOAD_LIMIT);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);
  const locale = await getServerLocale();
  return withApiRoute(
    request,
    { permission: "server:ssh", errorMessage: t("apiServersFileProxy.stopErrorMessage", locale) },
    async ({ session }) => {
      if (!session)
        return NextResponse.json(
          { error: t("apiServersFileProxy.unauthorized", locale) },
          { status: 401 },
        );
      if (!sessionHasPermission(session, "server:ssh")) {
        return NextResponse.json(
          { error: t("apiServersFileProxy.missingSshPermission", locale) },
          { status: 403 },
        );
      }
      const { id } = await params;
      const teamAccessDelete = await assertServerTeamAccess(session, id);
      if (!teamAccessDelete.ok) return teamAccessDelete.response;
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

        if (server && proxy.pid) {
          await sshExec(
            server as {
              host: string;
              port: number;
              username: string;
              password: string | null;
              sshKey: { privateKey: string } | null;
    hostKeySha256?: string | null;
            },
            `kill ${proxy.pid} 2>/dev/null; rm -f /tmp/.vps_file_proxy_*.py /tmp/.vps_proxy_out`,
          );
        }

        await prisma.serverFileProxy.update({
          where: { id: proxy.id },
          data: { status: "stopped" },
        });

        return NextResponse.json({ status: "stopped" });
      } catch (error) {
        const msg = error instanceof Error ? error.message : t("apiServersFileProxy.operationFailed", locale);
        throw new AppError({ code: "INTERNAL_ERROR", message: msg, status: 500 });
      }
    },
  );
}
