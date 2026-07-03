import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Client, type ConnectConfig } from "ssh2";
import { z } from "zod";

import { connectSsh } from "@/lib/ssh/client";
import {
	archiveStreamResponse,
	closeSshClientOnStreamEnd,
	safeArchiveName,
	streamLocalTarGz,
	streamRemoteTarGz,
} from "@/lib/storage/archive-stream";
import { buildContentDisposition } from "@/lib/http/content-disposition";
import { nodeStreamToWeb } from "@/lib/http/node-to-web-stream";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { normalizeSharePath, resolveShareToken } from "@/lib/share-link/service";
import { expandStorageBasePath } from "@/lib/storage/path-utils";
import { normalizeRemoteTargetPath } from "@/lib/storage/remote-path";
import { resolveStorageSshCredentials } from "@/lib/storage/ssh-credentials";

import { apiError } from "@/lib/http/api-error";
import { getServerLocale, t } from "@/lib/i18n/translations";
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

async function openSftpFile(client: Client, remotePath: string) {
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
	const locale = await getServerLocale();

	if (!token || token.length < 10) {
		return apiError({ code: "VALIDATION_FAILED", message: t("apiShareToken.invalidToken", locale), status: 400 });
	}

	let share: Awaited<ReturnType<typeof resolveShareToken>>;
	try {
		const { password } = parseSearchParams(
			request,
			z.object({ password: z.string().min(1).max(128).optional() }),
		);
		share = await resolveShareToken(token, password);
	} catch (err) {
		const message = err instanceof Error ? err.message : t("apiShareToken.invalidToken", locale);
		return apiError({ code: "NOT_FOUND", message: message, status: 404 });
	}

	let targetPath = share.path;
	const { path: childPath, archive } = parseSearchParams(
		request,
		z.object({
			path: z.string().trim().min(1).optional(),
			archive: z
				.string()
				.optional()
				.transform((value) => value === "1"),
		}),
	);
	const wantsArchive = archive;
	if (share.entryType === "DIRECTORY") {
		if (wantsArchive) {
			targetPath = share.path;
		} else {
			if (!childPath) return apiError({ code: "VALIDATION_FAILED", message: t("apiShareToken.directoryNeedsChild", locale), status: 400 });
			try {
				targetPath = normalizeSharePath(childPath);
			} catch {
				return apiError({ code: "VALIDATION_FAILED", message: t("apiShareToken.invalidPath", locale), status: 400 });
			}
			const prefix = `${share.path.replace(/^\/+|\/+$/g, "")}/`;
			if (targetPath !== share.path && !targetPath.startsWith(prefix)) {
				return apiError({ code: "FORBIDDEN", message: t("apiShareToken.outOfRange", locale), status: 403 });
			}
		}
	} else if (share.entryType !== "FILE") {
		return apiError({ code: "VALIDATION_FAILED", message: t("apiShareToken.notDownloadable", locale), status: 400 });
	}

	const node = share.storageNode;
	const fileName = targetPath.split("/").pop() || share.name || targetPath;

	if (node.driver === "LOCAL") {
		const allowedRoot = path.resolve(expandStorageBasePath(node.basePath));
		const absolutePath = path.resolve(allowedRoot, targetPath);
		const relativeToRoot = path.relative(allowedRoot, absolutePath);
		if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
			return apiError({ code: "VALIDATION_FAILED", message: t("apiShareToken.invalidPath", locale), status: 400 });
		}
		try {
			const fileStat = await stat(absolutePath);
			if (wantsArchive) {
				if (share.entryType !== "DIRECTORY" || !fileStat.isDirectory()) {
					return apiError({ code: "VALIDATION_FAILED", message: t("apiShareToken.notPackagable", locale), status: 400 });
				}
				const stream = streamLocalTarGz(absolutePath, path.basename(absolutePath));
				return archiveStreamResponse(stream, safeArchiveName(share.name || path.basename(absolutePath)));
			}
			if (!fileStat.isFile()) return apiError({ code: "VALIDATION_FAILED", message: t("apiShareToken.notDownloadable", locale), status: 400 });
			return fileResponse(createReadStream(absolutePath), { size: fileStat.size, fileName });
		} catch {
			return apiError({ code: "NOT_FOUND", message: t("apiShareToken.localNotFound", locale), status: 404 });
		}
	}

	if (node.driver === "SFTP") {
		let remotePath: string;
		try {
			remotePath = normalizeRemoteTargetPath(node.basePath, targetPath);
		} catch {
			return apiError({ code: "VALIDATION_FAILED", message: t("apiShareToken.invalidPath", locale), status: 400 });
		}
		let credentials: ReturnType<typeof resolveStorageSshCredentials>;
		try {
			credentials = resolveStorageSshCredentials(node);
		} catch (err) {
			return apiError({ code: "VALIDATION_FAILED", message: err instanceof Error ? err.message : t("apiShareToken.missingRemoteCredentials", locale), status: 400 });
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
			if (wantsArchive) {
				if (share.entryType !== "DIRECTORY") {
					return apiError({ code: "VALIDATION_FAILED", message: t("apiShareToken.notPackagable", locale), status: 400 });
				}
				const stream = await streamRemoteTarGz(client, remotePath);
				closeSshClientOnStreamEnd(stream, client);
				client = null;
				return archiveStreamResponse(stream, safeArchiveName(share.name || fileName));
			}
			const { stream, size } = await openSftpFile(client, remotePath);
			stream.on("close", () => client?.end());
			stream.on("error", () => client?.end());
			return fileResponse(stream, { size, fileName });
		} catch {
			client?.end();
			return apiError({ code: "NOT_FOUND", message: t("apiShareToken.remoteNotFound", locale), status: 404 });
		}
	}

	return apiError({ code: "VALIDATION_FAILED", message: t("apiShareToken.unsupportedDriver", locale), status: 400 });
}
