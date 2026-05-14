/**
 * POST /api/servers/[id]/file-proxy — 在目标服务器上启动/管理文件代理
 * GET  /api/servers/[id]/file-proxy — 获取文件代理状态
 * DELETE /api/servers/[id]/file-proxy — 停止文件代理
 * 
 * 实现方式：通过 SSH 在目标服务器上启动一个临时 Python HTTP 服务器
 * 支持直连模式：浏览器直接从目标服务器获取文件内容
 */

import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/require-api-session";
import { prisma } from "@/lib/db";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

// 在目标服务器上执行 SSH 命令的辅助函数
async function sshExec(
 server: { host: string; port: number; username: string; password: string | null; sshKey: { privateKey: string } | null },
 command: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
 const { Client } = await import("ssh2");
 const sshClient = new Client();

 return new Promise((resolve) => {
  const config: Record<string, unknown> = {
   host: server.host,
   port: server.port,
   username: server.username,
   readyTimeout: 10000,
  };

  if (server.sshKey?.privateKey) {
   config.privateKey = server.sshKey.privateKey;
  } else if (server.password) {
   config.password = server.password;
  }

  sshClient.on("ready", () => {
   sshClient.exec(command, { pty: false }, (err, stream) => {
    if (err) {
     sshClient.end();
     resolve({ stdout: "", stderr: err.message, exitCode: -1 });
     return;
    }

    let stdout = "";
    let stderr = "";
    stream.on("data", (data: Buffer) => { stdout += data.toString(); });
    stream.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });
    stream.on("close", (code: number) => {
     sshClient.end();
     resolve({ stdout, stderr, exitCode: code });
    });
   });
  });

  sshClient.on("error", (err) => {
   resolve({ stdout: "", stderr: err.message, exitCode: -1 });
  });

  sshClient.connect(config as Parameters<typeof sshClient.connect>[0]);
 });
}

// ── GET: 获取文件代理状态 ────────────────────────────────

export async function GET(
 _request: Request,
 { params }: { params: Promise<{ id: string }> }
) {
 const authed = await requireApiSession();
 if (authed instanceof NextResponse) return authed;
 const { id } = await params;

 const server = await prisma.server.findUnique({
  where: { id },
  include: { sshKey: true },
 });

 if (!server) {
  return NextResponse.json({ error: "服务器不存在" }, { status: 404 });
 }

 const proxy = await prisma.serverFileProxy.findUnique({
  where: { serverId_proxyType: { serverId: id, proxyType: "python_http" } },
 });

 if (!proxy) {
  return NextResponse.json({ status: "stopped", proxy: null });
 }

 // 检查代理进程是否还在运行
 const checkResult = await sshExec(
  server as { host: string; port: number; username: string; password: string | null; sshKey: { privateKey: string } | null },
  `ps -p ${proxy.pid} -o pid= 2>/dev/null || echo "not_running"`,
 );

 const isRunning = checkResult.stdout.trim() !== "not_running" && checkResult.exitCode === 0;

 if (!isRunning && proxy.status === "running") {
  // 更新状态为已停止
  await prisma.serverFileProxy.update({
   where: { id: proxy.id },
   data: { status: "stopped" },
  });
 }

 return NextResponse.json({
  status: isRunning ? proxy.status : "stopped",
  proxy: isRunning ? {
   id: proxy.id,
   port: proxy.port,
   accessToken: proxy.accessToken,
   publicUrl: server.publicUrl,
   expiresAt: proxy.expiresAt,
  } : null,
 });
}

// ── POST: 启动文件代理 ───────────────────────────────────

export async function POST(
 _request: Request,
 { params }: { params: Promise<{ id: string }> }
) {
 const authed = await requireApiSession();
 if (authed instanceof NextResponse) return authed;
 const { id } = await params;

 const server = await prisma.server.findUnique({
  where: { id },
  include: { sshKey: true },
 });

 if (!server) {
  return NextResponse.json({ error: "服务器不存在" }, { status: 404 });
 }

 if (!server.publicUrl) {
  return NextResponse.json({ error: "服务器未配置公网访问地址(publicUrl)，无法启用直连模式" }, { status: 400 });
 }

 // 检查是否已有代理在运行
 const existing = await prisma.serverFileProxy.findUnique({
  where: { serverId_proxyType: { serverId: id, proxyType: "python_http" } },
 });

 if (existing && existing.status === "running") {
  // 检查是否真的在运行
  const check = await sshExec(
   server as { host: string; port: number; username: string; password: string | null; sshKey: { privateKey: string } | null },
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
 const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2小时后过期

 // 生成启动脚本：Python HTTP 服务器 + 简单 token 验证
 const proxyScript = `
import http.server
import os
import sys
import json
import urllib.parse

TOKEN = "${accessToken}"
SERVE_DIR = "/"

class AuthHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        if query.get("token", [""])[0] != TOKEN:
            self.send_error(403, "Forbidden: invalid token")
            return
        # Remove token from path for actual file serving
        self.path = self.path.split("?")[0]
        return super().do_GET()
    
    def end_headers(self):
        # CORS headers
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization")
        super().end_headers()
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

port = ${desiredPort || 0}
with http.server.HTTPServer(("0.0.0.0", port), AuthHandler) as httpd:
    actual_port = httpd.server_address[1]
    print(f"PROXY_READY:{actual_port}", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
`.trim();

 // 写入脚本并启动
 const remoteScriptPath = `/tmp/.vps_file_proxy_${Date.now()}.py`;
 const startCmd = `cat > ${remoteScriptPath} << 'PROXYEOF'\n${proxyScript}\nPROXYEOF\nnohup python3 ${remoteScriptPath} > /tmp/.vps_proxy_out 2>&1 & echo $!`;

 const result = await sshExec(
  server as { host: string; port: number; username: string; password: string | null; sshKey: { privateKey: string } | null },
  startCmd,
 );

 const pid = parseInt(result.stdout.trim(), 10);
 if (isNaN(pid) || pid <= 0) {
  return NextResponse.json({ error: "启动文件代理失败", details: result.stderr }, { status: 500 });
 }

 // 等待代理启动并获取实际端口
 await new Promise((r) => setTimeout(r, 1500));
 const portResult = await sshExec(
  server as { host: string; port: number; username: string; password: string | null; sshKey: { privateKey: string } | null },
  `cat /tmp/.vps_proxy_out 2>/dev/null | grep "PROXY_READY" | head -1`,
 );

 const portMatch = portResult.stdout.match(/PROXY_READY:(\d+)/);
 const actualPort = portMatch ? parseInt(portMatch[1], 10) : desiredPort;

 if (!actualPort) {
  return NextResponse.json({ error: "无法确定代理端口" }, { status: 500 });
 }

 // 保存到数据库
 const proxy = await prisma.serverFileProxy.upsert({
  where: { serverId_proxyType: { serverId: id, proxyType: "python_http" } },
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
}

// ── DELETE: 停止文件代理 ─────────────────────────────────

export async function DELETE(
 _request: Request,
 { params }: { params: Promise<{ id: string }> }
) {
 const authed = await requireApiSession();
 if (authed instanceof NextResponse) return authed;
 const { id } = await params;

 const proxy = await prisma.serverFileProxy.findUnique({
  where: { serverId_proxyType: { serverId: id, proxyType: "python_http" } },
 });

 if (!proxy) {
  return NextResponse.json({ status: "stopped" });
 }

 // 终止远程进程
 const server = await prisma.server.findUnique({
  where: { id },
  include: { sshKey: true },
 });

 if (server && proxy.pid) {
  await sshExec(
   server as { host: string; port: number; username: string; password: string | null; sshKey: { privateKey: string } | null },
   `kill ${proxy.pid} 2>/dev/null; rm -f /tmp/.vps_file_proxy_*.py /tmp/.vps_proxy_out`,
  );
 }

 await prisma.serverFileProxy.update({
  where: { id: proxy.id },
  data: { status: "stopped" },
 });

 return NextResponse.json({ status: "stopped" });
}
