import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import os from "node:os";
import path from "node:path";

import { Client, type ConnectConfig } from "ssh2";
import { NextResponse } from "next/server";
import sharp from "sharp";

import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { createLogger } from "@/lib/logging";
import { getMediaItem } from "@/lib/media/service";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { expandStorageBasePath, normalizeStorageRelativePath } from "@/lib/storage/path-utils";
import { normalizeRemoteRelativePath, normalizeRemoteTargetPath, toClientStorageError } from "@/lib/storage/remote-path";
import { resolveStorageSshCredentials } from "@/lib/storage/ssh-credentials";

export const dynamic = "force-dynamic";

const logger = createLogger("api:media:thumbnail");

const THUMB_SIZE = 320;
const SUPPORTED_IMAGE_MIME_PREFIX = "image/";
// We deliberately skip video frame extraction here: extracting a still frame
// requires shipping ffmpeg into the runtime image. For the v1 thumbnail layer
// we only optimize image media, where the win is largest (galleries with many
// large originals). Video tiles fall back to a generic poster on the client.

function thumbnailCacheRoot(): string {
	const base = process.env.MEDIA_THUMB_CACHE_DIR?.trim();
	if (base) return base;
	return path.join(os.tmpdir(), "vcontrolhub-thumbnails");
}

function thumbnailKey(input: { id: string; size: number; updatedAt: string | Date | null | undefined; relativePath: string }): string {
	const updated = input.updatedAt
		? typeof input.updatedAt === "string" ? input.updatedAt : input.updatedAt.toISOString()
		: "";
	const hash = createHash("sha1")
		.update(`${input.id}|${input.size}|${updated}|${input.relativePath}`)
		.digest("hex");
	return `${hash}.jpg`;
}

async function getCachedThumbnail(filePath: string): Promise<Buffer | null> {
	try {
		const info = await stat(filePath);
		if (!info.isFile() || info.size === 0) return null;
		return await readFile(filePath);
	} catch {
		return null;
	}
}

async function generateThumbnailFromBuffer(buffer: Buffer): Promise<Buffer> {
	return sharp(buffer, { failOn: "none" })
		.rotate()
		.resize({
			width: THUMB_SIZE,
			height: THUMB_SIZE,
			fit: "inside",
			withoutEnlargement: true,
		})
		.jpeg({ quality: 78, progressive: true, mozjpeg: false })
		.toBuffer();
}

function resolveManagedLocalPath(basePath: string, relativePath: string) {
	const normalized = normalizeStorageRelativePath(relativePath);
	if (!normalized.ok) throw new Error(normalized.reason);
	const allowedRoot = path.resolve(expandStorageBasePath(basePath));
	const absolutePath = path.resolve(allowedRoot, normalized.path);
	const relativeToRoot = path.relative(allowedRoot, absolutePath);
	if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) throw new Error("非法路径");
	return absolutePath;
}

function readLocalIntoBuffer(absolutePath: string, maxBytes: number): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let total = 0;
		const stream = createReadStream(absolutePath);
		stream.on("data", (chunk: string | Buffer) => {
			const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
			total += buf.length;
			if (total > maxBytes) {
				stream.destroy(new Error("THUMBNAIL_SOURCE_TOO_LARGE"));
				return;
			}
			chunks.push(buf);
		});
		stream.on("end", () => resolve(Buffer.concat(chunks)));
		stream.on("error", (err) => reject(err));
	});
}

function connectSsh(config: ConnectConfig): Promise<Client> {
	return new Promise((resolve, reject) => {
		const client = new Client();
		client.on("ready", () => resolve(client));
		client.on("error", (err) => reject(err));
		client.connect(config);
	});
}

function readRemoteIntoBuffer(client: Client, remotePath: string, maxBytes: number): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		client.sftp((err, sftp) => {
			if (err) return reject(err);
			sftp.stat(remotePath, (statErr, stats) => {
				if (statErr) return reject(statErr);
				if (!stats.isFile()) return reject(new Error("目标不是可读取的文件"));
				if (stats.size > maxBytes) {
					return reject(new Error("THUMBNAIL_SOURCE_TOO_LARGE"));
				}
				const stream = sftp.createReadStream(remotePath);
				const chunks: Buffer[] = [];
				stream.on("data", (chunk: Buffer) => chunks.push(chunk));
				stream.on("end", () => resolve(Buffer.concat(chunks)));
				stream.on("error", (e: Error) => reject(e));
			});
		});
	});
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
	const session = await requireSession("/media");
	if (!sessionHasPermission(session, "storage:read")) {
		return NextResponse.json({ error: "缺少存储读取权限" }, { status: 403 });
	}

	const { id } = await params;
	const item = await getMediaItem(id);
	if (!item || !item.storageNode) return NextResponse.json({ error: "媒体不存在" }, { status: 404 });

	const mime = (item.mimeType ?? "").toLowerCase();
	if (!mime.startsWith(SUPPORTED_IMAGE_MIME_PREFIX)) {
		// Tell the client we don't have a thumbnail; the UI then falls back to the
		// generic kind icon (and avoids hammering /stream for big videos).
		return NextResponse.json({ error: "该媒体类型暂不支持缩略图" }, { status: 415 });
	}

	const accessDecision = await assertStorageAccess({
		session,
		storageNodeId: item.storageNode.id,
		relativePath: item.relativePath,
		operation: "read",
	});
	if (!accessDecision.allowed) {
		return NextResponse.json({ error: accessDecision.reason ?? "缺少存储访问授权" }, { status: 403 });
	}

	const cacheRoot = thumbnailCacheRoot();
	const cacheFile = path.join(
		cacheRoot,
		thumbnailKey({
			id: item.id,
			size: THUMB_SIZE,
			updatedAt: item.updatedAt ?? null,
			relativePath: item.relativePath,
		}),
	);

	const cached = await getCachedThumbnail(cacheFile);
	if (cached) {
		return new NextResponse(new Uint8Array(cached), {
			headers: {
				"Content-Type": "image/jpeg",
				"Content-Length": String(cached.length),
				"Cache-Control": "public, max-age=86400, immutable",
				"X-Thumbnail-Cache": "hit",
			},
		});
	}

	const node = item.storageNode;
	// Thumbnail input is always small enough to buffer; cap source reads at 32MB
	// to avoid pulling 4GB videos into memory if the client somehow asks for a
	// /thumbnail of a non-image (defense-in-depth — we already guarded by mime).
	const MAX_SOURCE_BYTES = 32 * 1024 * 1024;

	let sourceBuffer: Buffer;
	try {
		if (node.driver === "LOCAL") {
			const absolutePath = resolveManagedLocalPath(node.basePath, item.relativePath);
			sourceBuffer = await readLocalIntoBuffer(absolutePath, MAX_SOURCE_BYTES);
		} else if (node.driver === "SFTP") {
			let normalizedRemotePath: string;
			let normalizedRelativePath: string;
			try {
				normalizedRemotePath = normalizeRemoteTargetPath(node.basePath, item.relativePath);
				normalizedRelativePath = normalizeRemoteRelativePath(item.relativePath);
			} catch {
				return NextResponse.json(toClientStorageError("请求路径超出存储节点根目录"), { status: 400 });
			}
			const remoteAccess = await assertStorageAccess({
				session,
				storageNodeId: node.id,
				relativePath: normalizedRelativePath,
				operation: "read",
			});
			if (!remoteAccess.allowed) {
				return NextResponse.json({ error: remoteAccess.reason ?? "缺少存储访问授权" }, { status: 403 });
			}
			const credentials = (() => {
				try { return resolveStorageSshCredentials(node); }
				catch (e) { return e instanceof Error ? e : new Error("缺少远端主机地址或连接凭据"); }
			})();
			if (credentials instanceof Error) {
				return NextResponse.json({ error: credentials.message }, { status: 400 });
			}
			const client = await connectSsh({
				host: credentials.host,
				port: credentials.port,
				username: credentials.username,
				privateKey: credentials.privateKey,
				password: credentials.password,
				readyTimeout: 15000,
				timeout: 10000,
			});
			try {
				sourceBuffer = await readRemoteIntoBuffer(client, normalizedRemotePath, MAX_SOURCE_BYTES);
			} finally {
				client.end();
			}
		} else {
			return NextResponse.json({ error: "该存储节点暂不支持缩略图" }, { status: 400 });
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : "未知错误";
		if (message === "THUMBNAIL_SOURCE_TOO_LARGE") {
			return NextResponse.json({ error: "原始图片过大，无法生成缩略图" }, { status: 413 });
		}
		logger.error("media thumbnail read source failed", error, { id, nodeId: node.id });
		return NextResponse.json({ error: "读取媒体源失败" }, { status: 502 });
	}

	let thumbnail: Buffer;
	try {
		thumbnail = await generateThumbnailFromBuffer(sourceBuffer);
	} catch (error) {
		logger.error("media thumbnail generate failed", error, { id });
		return NextResponse.json({ error: "缩略图生成失败" }, { status: 500 });
	}

	try {
		await mkdir(cacheRoot, { recursive: true });
		await writeFile(cacheFile, thumbnail);
	} catch (error) {
		logger.warn("media thumbnail cache write failed", { error, id, cacheFile });
	}

	return new NextResponse(new Uint8Array(thumbnail), {
		headers: {
			"Content-Type": "image/jpeg",
			"Content-Length": String(thumbnail.length),
			"Cache-Control": "public, max-age=86400, immutable",
			"X-Thumbnail-Cache": "miss",
		},
	});
}
