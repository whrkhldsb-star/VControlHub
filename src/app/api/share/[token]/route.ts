import { NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Client, type ConnectConfig } from "ssh2";

import { buildContentDisposition } from "@/lib/http/content-disposition";
import { nodeStreamToWeb } from "@/lib/http/node-to-web-stream";
import { normalizeSharePath, resolveShareToken } from "@/lib/share-link/service";
import { expandStorageBasePath } from "@/lib/storage/path-utils";
import { normalizeRemoteTargetPath } from "@/lib/storage/remote-path";
import { resolveStorageSshCredentials } from "@/lib/storage/ssh-credentials";

export const dynamic = "force-dynamic";

function guessContentType(fileName: string): string {
	const ext = path.extname(fileName).toLowerCase();
	if ([".jpg", ".jpeg"].includes(ext)) return "image/jpeg";
	if (ext === ".png") return "image/png";
	if (ext === ".webp") return "image/webp";
	if (ext === ".gif") return "image/gif";
	if (ext === ".svg") return "image/svg+xml";
	if (ext === ".mp4") return "video/mp4";
	if (ext === ".webm") return "video/webm";
	if (ext === ".mp3") return "audio/mpeg";
	if (ext === ".m4a") return "audio/mp4";
	if (ext === ".flac") return "audio/flac";
	if (ext === ".wav") return "audio/wav";
	if (ext === ".pdf") return "application/pdf";
	if (ext === ".txt") return "text/plain; charset=utf-8";
	return "application/octet-stream";
}

function connectSsh(config: ConnectConfig): Promise<Client> {
	return new Promise((resolve, reject) => {
		const client = new Client();
		client.on("ready", () => resolve(client));
		client.on("error", reject);
		client.connect(config);
	});
}

function openSftpFile(client: Client, remotePath: string) {
	return new Promise<{ stream: import("stream").Readable; size: number }>((resolve, reject) => {
		client.sftp((err, sftp) => {
			if (err) return reject(err);
			sftp.stat(remotePath, (statErr, stats) => {
				if (statErr) return reject(statErr);
				if (!stats.isFile()) return reject(new Error("分享目标不是可下载文件"));
				resolve({ stream: sftp.createReadStream(remotePath) as import("stream").Readable, size: stats.size });
			});
		});
	});
}

function fileResponse(stream: import("stream").Readable, input: { size: number; fileName: string }) {
	const headers = new Headers();
	headers.set("content-type", guessContentType(input.fileName));
	headers.set("content-length", String(input.size));
	headers.set("cache-control", "private, no-store");
	headers.set("content-disposition", buildContentDisposition("attachment", input.fileName));
	return new Response(nodeStreamToWeb(stream), { status: 200, headers });
}

/**
 * Public share-link file access.
 * No authentication required — the share token itself is the credential.
 */
export async function GET(
	request: Request,
	{ params }: { params: Promise<{ token: string }> },
) {
	const { token } = await params;

	if (!token || token.length < 10) {
		return NextResponse.json({ error: "分享链接无效" }, { status: 400 });
	}

	let share: Awaited<ReturnType<typeof resolveShareToken>>;
	try {
		share = await resolveShareToken(token);
	} catch (err) {
		const message = err instanceof Error ? err.message : "分享链接无效";
		return NextResponse.json({ error: message }, { status: 404 });
	}

	let targetPath = share.path;
	if (share.entryType === "DIRECTORY") {
		const childPath = new URL(request.url).searchParams.get("path");
		if (!childPath) return NextResponse.json({ error: "请选择目录中的具体文件" }, { status: 400 });
		try {
			targetPath = normalizeSharePath(childPath);
		} catch {
			return NextResponse.json({ error: "非法路径" }, { status: 400 });
		}
		const prefix = `${share.path.replace(/^\/+|\/+$/g, "")}/`;
		if (targetPath !== share.path && !targetPath.startsWith(prefix)) {
			return NextResponse.json({ error: "文件不在分享目录范围内" }, { status: 403 });
		}
	} else if (share.entryType !== "FILE") {
		return NextResponse.json({ error: "分享目标不是可下载文件" }, { status: 400 });
	}

	const node = share.storageNode;
	const fileName = targetPath.split("/").pop() || share.name || targetPath;

	if (node.driver === "LOCAL") {
		const allowedRoot = path.resolve(expandStorageBasePath(node.basePath));
		const absolutePath = path.resolve(allowedRoot, targetPath);
		const relativeToRoot = path.relative(allowedRoot, absolutePath);
		if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
			return NextResponse.json({ error: "非法路径" }, { status: 400 });
		}
		try {
			const fileStat = await stat(absolutePath);
			if (!fileStat.isFile()) return NextResponse.json({ error: "分享目标不是可下载文件" }, { status: 400 });
			return fileResponse(createReadStream(absolutePath), { size: fileStat.size, fileName });
		} catch {
			return NextResponse.json({ error: "文件不存在或暂时无法读取" }, { status: 404 });
		}
	}

	if (node.driver === "SFTP") {
		let remotePath: string;
		try {
			remotePath = normalizeRemoteTargetPath(node.basePath, targetPath);
		} catch {
			return NextResponse.json({ error: "非法路径" }, { status: 400 });
		}
		let credentials: ReturnType<typeof resolveStorageSshCredentials>;
		try {
			credentials = resolveStorageSshCredentials(node);
		} catch (err) {
			return NextResponse.json({ error: err instanceof Error ? err.message : "缺少远端连接凭据" }, { status: 400 });
		}
		let client: Client | null = null;
		try {
			client = await connectSsh({
				host: credentials.host,
				port: credentials.port,
				username: credentials.username,
				privateKey: credentials.privateKey,
				password: credentials.password,
				readyTimeout: 15000,
				timeout: 10000,
			});
			const { stream, size } = await openSftpFile(client, remotePath);
			stream.on("close", () => client?.end());
			stream.on("error", () => client?.end());
			return fileResponse(stream, { size, fileName });
		} catch {
			client?.end();
			return NextResponse.json({ error: "远端文件不存在或暂时无法读取" }, { status: 404 });
		}
	}

	return NextResponse.json({ error: "该存储节点暂不支持公开分享下载" }, { status: 400 });
}
