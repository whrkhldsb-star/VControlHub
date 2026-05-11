import path from "node:path";

import { Client, type ConnectConfig } from "ssh2";
import { NextResponse } from "next/server";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";

import { prisma } from "@/lib/db";
import { buildContentDisposition } from "@/lib/http/content-disposition";
import { createLogger } from "@/lib/logging";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { normalizeRemoteTargetPath, toClientStorageError } from "@/lib/storage/remote-path";

const logger = createLogger("api:storage:sftp-download");

export const dynamic = "force-dynamic";

function guessContentType(fileName: string): string {
 const ext = path.extname(fileName).toLowerCase();
 if ([".jpg", ".jpeg"].includes(ext)) return "image/jpeg";
 if (ext === ".png") return "image/png";
 if (ext === ".webp") return "image/webp";
 if (ext === ".gif") return "image/gif";
 if (ext === ".svg") return "image/svg+xml";
 if (ext === ".bmp") return "image/bmp";
 if (ext === ".ico") return "image/x-icon";
 if (ext === ".mp4") return "video/mp4";
 if (ext === ".webm") return "video/webm";
 if (ext === ".mkv") return "video/x-matroska";
 if (ext === ".avi") return "video/x-msvideo";
 if (ext === ".mp3") return "audio/mpeg";
 if (ext === ".wav") return "audio/wav";
 if (ext === ".ogg") return "audio/ogg";
 if (ext === ".flac") return "audio/flac";
 if (ext === ".aac") return "audio/aac";
 if (ext === ".pdf") return "application/pdf";
 if (ext === ".txt") return "text/plain; charset=utf-8";
 if (ext === ".json") return "application/json; charset=utf-8";
 if (ext === ".xml") return "application/xml; charset=utf-8";
 if (ext === ".html" || ext === ".htm") return "text/html; charset=utf-8";
 if (ext === ".css") return "text/css; charset=utf-8";
 if (ext === ".js") return "application/javascript; charset=utf-8";
 if (ext === ".zip") return "application/zip";
 if (ext === ".tar") return "application/x-tar";
 if (ext === ".gz") return "application/gzip";
 if (ext === ".7z") return "application/x-7z-compressed";
 return "application/octet-stream";
}

function connectSsh(config: ConnectConfig): Promise<Client> {
 return new Promise((resolve, reject) => {
 const client = new Client();
 client.on("ready", () => resolve(client));
 client.on("error", (err) => reject(err));
 client.connect(config);
 });
}

function getSftpStream(
 client: Client,
 remotePath: string,
): Promise<{ stream: import("stream").Readable; stat: { size: number } }> {
 return new Promise((resolve, reject) => {
 client.sftp((err, sftp) => {
 if (err) return reject(err);

 sftp.stat(remotePath, (statErr, stats) => {
 if (statErr) return reject(statErr);
 if (!stats.isFile()) return reject(new Error("目标不是可下载文件"));

 const readStream = sftp.createReadStream(remotePath);
 resolve({ stream: readStream as import("stream").Readable, stat: { size: stats.size } });
 });
 });
 });
}

export async function GET(request: Request) {
 const session = await requireSession();
 if (!sessionHasPermission(session, "storage:read")) {
 return NextResponse.json({ error: "缺少权限" }, { status: 403 });
 }

 const url = new URL(request.url);
 const nodeId = url.searchParams.get("nodeId");
 const remotePath = url.searchParams.get("path");
 const download = url.searchParams.get("download") === "1";

 if (!nodeId) {
 return NextResponse.json({ error: "缺少 nodeId 参数" }, { status: 400 });
 }

 if (!remotePath) {
 return NextResponse.json({ error: "缺少 path 参数" }, { status: 400 });
 }

 const node = await prisma.storageNode.findUnique({
 where: { id: nodeId },
 select: {
 id: true,
 name: true,
 driver: true,
 basePath: true,
 host: true,
 port: true,
 username: true,
 serverId: true,
 server: {
 select: {
 id: true,
 host: true,
 port: true,
 username: true,
 connectionType: true,
 password: true,
 sshKey: {
 select: {
 privateKey: true,
 },
 },
 },
 },
 },
 });

 if (!node) {
 return NextResponse.json({ error: "存储节点不存在" }, { status: 404 });
 }

 if (node.driver !== "SFTP") {
 return NextResponse.json({ error: "该节点不是 SFTP 类型" }, { status: 400 });
 }

 // 确定连接参数：优先使用节点自身的 host/port/username，否则从绑定的 server 继承
 const host = node.host ?? node.server?.host;
 const port = node.port ?? node.server?.port ?? 22;
 const username = node.username ?? node.server?.username ?? "root";
 const connectionType = node.server?.connectionType ?? "SSH_KEY";
 const privateKey = node.server?.sshKey?.privateKey ?? undefined;
 const password = node.server?.password ?? undefined;

 if (!host) {
 return NextResponse.json(
 { error: "缺少远端主机地址，无法连接" },
 { status: 400 },
 );
 }

 if (connectionType === "SSH_KEY" && !privateKey) {
 return NextResponse.json(
 { error: "缺少 SSH 私钥，无法连接" },
 { status: 400 },
 );
 }

 if (connectionType === "PASSWORD" && !password) {
 return NextResponse.json(
 { error: "缺少登录密码，无法连接" },
 { status: 400 },
 );
 }

 let normalizedRemotePath: string;
 try {
 normalizedRemotePath = normalizeRemoteTargetPath(node.basePath, remotePath);
 } catch {
 return NextResponse.json(toClientStorageError("请求路径超出存储节点根目录"), { status: 400 });
 }

 const accessDecision = await assertStorageAccess({
 session,
 storageNodeId: node.id,
 relativePath: remotePath,
 operation: "read",
 });
 if (!accessDecision.allowed) {
 return NextResponse.json({ error: accessDecision.reason ?? "缺少存储访问授权" }, { status: 403 });
 }

 const fileName = path.basename(normalizedRemotePath);
 const contentType = guessContentType(fileName);

 let client: Client | null = null;

 try {
 const config: ConnectConfig = {
 host,
 port,
 username,
 ...(connectionType === "PASSWORD" ? { password } : { privateKey }),
 readyTimeout: 15000,
 timeout: 10000,
 };

 client = await connectSsh(config);
 const { stream: nodeStream, stat } = await getSftpStream(client, normalizedRemotePath);

 // 将 Node.js ReadableStream 转换为 Web ReadableStream
 const webStream = new ReadableStream({
 start(controller) {
 nodeStream.on("data", (chunk: Buffer | string) => {
 controller.enqueue(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
 });
 nodeStream.on("end", () => {
 controller.close();
 // 流结束后关闭 SSH 连接
 client?.end();
 client = null;
 });
 nodeStream.on("error", (streamErr) => {
 controller.error(streamErr);
 client?.end();
 client = null;
 });
 },
 cancel() {
 nodeStream.destroy();
 client?.end();
 client = null;
 },
 });

 const headers = new Headers();
 headers.set("content-type", contentType);
 headers.set("content-length", String(stat.size));
 headers.set("cache-control", "private, no-store");
 headers.set(
 "content-disposition",
 buildContentDisposition(download ? "attachment" : "inline", fileName),
 );

 return new Response(webStream, { status: 200, headers });
 } catch (error) {
 // 确保出错时关闭连接
 client?.end();

 logger.error("read remote file for download failed", error, { nodeId });
 return NextResponse.json(toClientStorageError("获取远端文件失败，请检查文件是否存在或节点是否可连接"), { status: 502 });
 }
}
