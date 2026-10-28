import { openManagedArchive } from "@/lib/storage/archive-access";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { guessContentType } from "@/lib/http/mime-types";
import { Client } from "ssh2";
import { z } from "zod";

import { connectSsh, readRemoteFile } from "@/lib/ssh/client";
import {
	archiveStreamResponse,
	buildArchiveHeaders,
	closeSshClientOnStreamEnd,
	safeArchiveName,
	streamLocalTarGz,
	streamRemoteTarGz,
} from "@/lib/storage/archive-stream";
import { buildContentDisposition } from "@/lib/http/content-disposition";
import { nodeStreamToWeb } from "@/lib/http/node-to-web-stream";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import {
	assertShareTargetNotDeleted,
	authorizeShareDownload,
	hashShareToken,
	normalizeSharePath,
	releaseShareQuotaClaim,
	resolveShareToken,
} from "@/lib/share-link/service";
import { resolveStoragePathWithinBase } from "@/lib/storage/path-utils";
import { normalizeRemoteTargetPath } from "@/lib/storage/remote-path";
import { assertRemotePathContained } from "@/lib/storage/remote-containment";
import { resolveStorageSshCredentials } from "@/lib/storage/ssh-credentials";

import { apiError } from "@/lib/http/api-error";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { checkRateLimitAsync, getClientIp } from "@/lib/rate-limit";
import { rateLimitResponse, withRateLimit, type RateLimitConfig } from "@/lib/http/rate-limit-presets";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { getErrorMessage } from "@/lib/http/error-message";
import { readRequestBodyBuffer } from "@/lib/http/request-body";
import { NextResponse } from "next/server";
import { isRequestHttps } from "@/lib/http/request-https";
import {
	createShareDownloadTicket,
	getShareDownloadTicketCookieName,
	SHARE_DOWNLOAD_TICKET_MAX_AGE_SECONDS,
	verifyShareDownloadTicket,
} from "@/lib/share-link/download-ticket";
export const dynamic = "force-dynamic";
// guardMode: public

const SHARE_TOKEN_LIMIT: RateLimitConfig = { maxRequests: 60, windowMs: 60_000 };
const SHARE_PASSWORD_LIMIT: RateLimitConfig = { maxRequests: 8, windowMs: 15 * 60_000 };
const SHARE_PASSWORD_MAX_BODY_BYTES = 1024;

function readCookie(request: Request, name: string): string | undefined {
	const value = request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))?.[1];
	if (!value) return undefined;
	try {
		return decodeURIComponent(value);
	} catch {
		return undefined;
	}
}

/**
 * Password guesses are throttled per share AND per client. Keyed directly: the
 * previous fake-request trick put `${ip}:share:${token}` into x-forwarded-for,
 * which normalizeClientIp rejects once it exceeds 64 characters (tokens are 48),
 * so every guess for a share landed in one shared "unknown" bucket and eight
 * wrong guesses from anyone locked that share for everybody for 15 minutes.
 */
async function checkSharePasswordRateLimit(clientIp: string | null, token: string) {
	return checkRateLimitAsync(`share-password:${token}:${clientIp ?? "unknown"}`, SHARE_PASSWORD_LIMIT);
}

const passwordAuthorizationSchema = z.object({
	password: z.string().min(1).max(128),
});

async function parsePasswordAuthorization(request: Request) {
	try {
		const text = (await readRequestBodyBuffer(request, SHARE_PASSWORD_MAX_BODY_BYTES)).toString("utf8");
		return passwordAuthorizationSchema.safeParse(text ? JSON.parse(text) : null);
	} catch {
		return passwordAuthorizationSchema.safeParse(null);
	}
}

/**
 * Exchange a share password for a short-lived, HttpOnly download credential.
 * The subsequent browser navigation remains a normal streaming GET, so large
 * files do not become a Blob in the page's JavaScript heap.
 */
export async function POST(
	request: Request,
	{ params }: { params: Promise<{ token: string }> },
) {
	const { token } = await params;
	const locale = await getServerLocale();
	const tokenRateLimit = await withRateLimit(request, SHARE_TOKEN_LIMIT);
	if (!tokenRateLimit.allowed) return rateLimitResponse(tokenRateLimit.retryAfterMs);
	if (!token || token.length < 10) {
		return apiError({ code: "VALIDATION_FAILED", message: t("apiShareToken.invalidToken", locale), status: 400 });
	}
	const parsed = await parsePasswordAuthorization(request);
	if (!parsed.success) {
		return apiError({ code: "VALIDATION_FAILED", message: t("backend.shareLink.passwordRequired", locale), status: 400 });
	}

	const clientIp = getClientIp(request);
	const passwordLimit = await checkSharePasswordRateLimit(clientIp, token);
	if (!passwordLimit.allowed) return rateLimitResponse(passwordLimit.retryAfterMs);
	try {
		const share = await authorizeShareDownload(token, parsed.data.password, {
			ip: clientIp ?? undefined,
			userAgent: request.headers.get("user-agent") ?? undefined,
		});
		const response = NextResponse.json({ success: true });
		response.headers.set("cache-control", "no-store");
		response.cookies.set(getShareDownloadTicketCookieName(), createShareDownloadTicket({
			shareId: share.id,
			tokenHash: hashShareToken(token),
		}), {
			httpOnly: true,
			sameSite: "lax",
			secure: isRequestHttps(request),
			path: "/",
			maxAge: SHARE_DOWNLOAD_TICKET_MAX_AGE_SECONDS,
		});
		return response;
	} catch (err) {
		const message = getErrorMessage(err, t("apiShareToken.invalidToken", locale));
		return apiError({ code: err instanceof ForbiddenError ? "FORBIDDEN" : "NOT_FOUND", message, status: err instanceof ForbiddenError ? 403 : 404 });
	}
}

async function openSftpFile(client: Client, remotePath: string) {
	return new Promise<{ stream: import("stream").Readable; size: number }>((resolve, reject) => {
		client.sftp((err, sftp) => {
			if (err) return reject(err);
			sftp.stat(remotePath, (statErr, stats) => {
				if (statErr) return reject(statErr);
				if (!stats.isFile()) return reject(new Error("Share target is Not a downloadable file"));
				resolve({ stream: sftp.createReadStream(remotePath) as import("stream").Readable, size: stats.size });
			});
		});
	});
}

function fileHeaders(input: { size?: number; fileName: string; inline?: boolean }) {
	const headers = new Headers();
	headers.set("content-type", guessContentType(input.fileName));
	if (input.size !== undefined) headers.set("content-length", String(input.size));
	headers.set("cache-control", "private, no-store");
	// Never execute shared HTML/SVG/other active documents on the application's origin.
	const safeInline = input.inline && /^(?:image\/(?:png|jpeg|gif|webp|avif)|audio\/[\w.+-]+|video\/[\w.+-]+|text\/plain|application\/pdf)$/.test(guessContentType(input.fileName).split(';')[0]!.trim());
	headers.set("x-content-type-options", "nosniff");
	headers.set("content-security-policy", "sandbox; default-src 'none'; frame-ancestors 'none'");
	headers.set("referrer-policy", "no-referrer");
	headers.set("content-disposition", buildContentDisposition(safeInline ? "inline" : "attachment", input.fileName));
	return headers;
}

function fileResponse(stream: import("stream").Readable, input: { size: number; fileName: string; inline?: boolean }) {
	return new Response(nodeStreamToWeb(stream), { status: 200, headers: fileHeaders(input) });
}

/**
 * Public share-link file access.
 * No authentication required — the share token itself is the credential.
 */
export async function GET(
	request: Request,
	context: { params: Promise<{ token: string }> },
) {
	return serveShare(request, context, false);
}

/**
 * Headers only. Without this export Next answers HEAD with the GET handler:
 * a download manager's or link checker's HEAD counted (and logged) a
 * download and opened the file, so a one-download link was used up before
 * the real download started.
 */
export async function HEAD(
	request: Request,
	context: { params: Promise<{ token: string }> },
) {
	return serveShare(request, context, true);
}

async function serveShare(
	request: Request,
	{ params }: { params: Promise<{ token: string }> },
	head: boolean,
) {
	const { token } = await params;
	const locale = await getServerLocale();
	const tokenRateLimit = await withRateLimit(request, SHARE_TOKEN_LIMIT);
	if (!tokenRateLimit.allowed) return rateLimitResponse(tokenRateLimit.retryAfterMs);
	const clientIp = getClientIp(request);

	if (!token || token.length < 10) {
		return apiError({ code: "VALIDATION_FAILED", message: t("apiShareToken.invalidToken", locale), status: 400 });
	}

	let share: Awaited<ReturnType<typeof resolveShareToken>>;
	try {
		// Password travels in the x-share-password header, or (for browsers) the
		// HttpOnly download-ticket cookie minted by the POST gate. It is NEVER read
		// from the query string: a `?password=` secret leaks into proxy/access logs,
		// the Referer header, and browser history. Programmatic callers use the
		// header; the UI uses the POST→cookie flow (share-password-gate.tsx).
		const password = request.headers.get("x-share-password")?.trim() || undefined;
		const ticket = readCookie(request, getShareDownloadTicketCookieName());
		const authorizedShareId = ticket ? verifyShareDownloadTicket(ticket, hashShareToken(token)) : null;
		if (password) {
			const passwordLimit = await checkSharePasswordRateLimit(clientIp, token);
			if (!passwordLimit.allowed) return rateLimitResponse(passwordLimit.retryAfterMs);
		}
		share = await resolveShareToken(
			token,
			password,
			{ ip: clientIp ?? undefined, userAgent: request.headers.get("user-agent") ?? undefined },
			{ authorizedShareId, claimDownload: !head },
		);
	} catch (err) {
		const message = getErrorMessage(err, t("apiShareToken.invalidToken", locale));
		return apiError({ code: err instanceof ForbiddenError ? "FORBIDDEN" : "NOT_FOUND", message, status: err instanceof ForbiddenError ? 403 : 404 });
	}

	// Quota was claimed in resolveShareToken (not for HEAD); refund if we never
	// open a delivery stream.
	const denyAfterClaim = async (response: Response) => {
		if (!head) await releaseShareQuotaClaim(share.id);
		return response;
	};

	let targetPath = share.path;
	let query: { path?: string; archive: boolean; inline: boolean };
	try {
		query = parseSearchParams(
			request,
			z.object({
				path: z.string().trim().min(1).optional(),
				archive: z
					.string()
					.optional()
					.transform((value) => value === "1"),
				inline: z
					.string()
					.optional()
					.transform((value) => value === "1"),
			}),
		);
	} catch (err) {
		// A malformed query ("?path=", "?path=a&path=b") escaped as a 500 after the download had been counted: a
		// one-time link was used up by it. It is a 400, and the claim is given back.
		if (!(err instanceof ValidationError)) throw err;
		return denyAfterClaim(apiError({ code: "VALIDATION_FAILED", message: err.message, status: 400 }));
	}
	const { path: childPath, archive, inline } = query;
	const wantsArchive = archive;
	if (share.entryType === "DIRECTORY") {
		if (wantsArchive) {
			targetPath = share.path;
		} else {
			if (!childPath) return denyAfterClaim(apiError({ code: "VALIDATION_FAILED", message: t("apiShareToken.directoryNeedsChild", locale), status: 400 }));
			try {
				targetPath = normalizeSharePath(childPath);
			} catch {
				return denyAfterClaim(apiError({ code: "VALIDATION_FAILED", message: t("apiShareToken.invalidPath", locale), status: 400 }));
			}
			const prefix = `${share.path.replace(/^\/+|\/+$/g, "")}/`;
			if (targetPath !== share.path && !targetPath.startsWith(prefix)) {
				return denyAfterClaim(apiError({ code: "FORBIDDEN", message: t("apiShareToken.outOfRange", locale), status: 403 }));
			}
		}
	} else if (share.entryType !== "FILE") {
		return denyAfterClaim(apiError({ code: "VALIDATION_FAILED", message: t("apiShareToken.notDownloadable", locale), status: 400 }));
		}
	try {
		await assertShareTargetNotDeleted(share.storageNodeId, targetPath);
	} catch {
		return denyAfterClaim(apiError({ code: "NOT_FOUND", message: t("apiShareToken.invalidToken", locale), status: 404 }));
	}

	const node = share.storageNode;
	const fileName = targetPath.split("/").pop() || share.name || targetPath;
	if (head) {
		const headers = wantsArchive ? buildArchiveHeaders(safeArchiveName(share.name || fileName)) : fileHeaders({ fileName, inline });
		return new Response(null, { status: 200, headers });
	}

	if (node.driver === "WEBDAV") {
		if (wantsArchive) return denyAfterClaim(apiError({ code: "VALIDATION_FAILED", message: t("apiShareToken.unsupportedDriver", locale), status: 400 }));
		try {
			const { streamStorageFile } = await import("@/lib/storage/file-content");
			const opened = await streamStorageFile(node, targetPath);
			const stream = opened.stream as Readable;
			stream.once("close", opened.close);
			stream.once("error", opened.close);
			return fileResponse(stream, { size: opened.size, fileName, inline });
		} catch {
			return denyAfterClaim(apiError({ code: "NOT_FOUND", message: t("apiShareToken.remoteNotFound", locale), status: 404 }));
		}
	}

	if (node.driver === "LOCAL") {
		const resolved = resolveStoragePathWithinBase(node.basePath, targetPath);
		if (!resolved.ok) {
			return denyAfterClaim(apiError({ code: "VALIDATION_FAILED", message: t("apiShareToken.invalidPath", locale), status: 400 }));
		}
		const absolutePath = resolved.path;
		try {
			const fileStat = await stat(absolutePath);
			if (wantsArchive) {
				if (share.entryType !== "DIRECTORY" || !fileStat.isDirectory()) {
					return denyAfterClaim(apiError({ code: "VALIDATION_FAILED", message: t("apiShareToken.notPackagable", locale), status: 400 }));
				}
				const stream = await openManagedArchive({
					storageNodeId: node.id,
					relativePath: targetPath,
					signal: request.signal,
					open: (excluded) => streamLocalTarGz(absolutePath, path.basename(absolutePath), excluded),
				});
				return archiveStreamResponse(stream, safeArchiveName(share.name || path.basename(absolutePath)));
			}
			if (!fileStat.isFile()) return denyAfterClaim(apiError({ code: "VALIDATION_FAILED", message: t("apiShareToken.notDownloadable", locale), status: 400 }));
			return fileResponse(createReadStream(absolutePath), { size: fileStat.size, fileName, inline: inline && !wantsArchive });
		} catch {
			return denyAfterClaim(apiError({ code: "NOT_FOUND", message: t("apiShareToken.localNotFound", locale), status: 404 }));
		}
	}

	if (node.driver === "SFTP") {
		let remotePath: string;
		try {
			remotePath = normalizeRemoteTargetPath(node.basePath, targetPath);
		} catch {
			return denyAfterClaim(apiError({ code: "VALIDATION_FAILED", message: t("apiShareToken.invalidPath", locale), status: 400 }));
		}
		let credentials: ReturnType<typeof resolveStorageSshCredentials>;
		try {
			credentials = resolveStorageSshCredentials(node);
		} catch (err) {
			return denyAfterClaim(apiError({ code: "VALIDATION_FAILED", message: getErrorMessage(err, t("apiShareToken.missingRemoteCredentials", locale)), status: 400 }));
		}
		try {
			remotePath = await assertRemotePathContained(credentials, node.basePath, remotePath);
		} catch (err) {
			if (err instanceof ValidationError) {
				return denyAfterClaim(apiError({ code: "VALIDATION_FAILED", message: t("apiShareToken.invalidPath", locale), status: 400 }));
			}
			return denyAfterClaim(apiError({ code: "NOT_FOUND", message: t("apiShareToken.remoteNotFound", locale), status: 404 }));
		}
		let client: Client | null = null;
		try {
			const agentOnly = Boolean(
				credentials.agentServerId && !credentials.privateKey && !credentials.password,
			);
			if (agentOnly) {
				if (wantsArchive) {
					return denyAfterClaim(apiError({
						code: "VALIDATION_FAILED",
						message: t("apiShareToken.agentArchiveNeedsDirect", locale),
						status: 400,
					}));
				}
				try {
					const buffer = await readRemoteFile({ ...credentials, remotePath });
					return fileResponse(Readable.from(buffer), { size: buffer.length, fileName, inline: inline && !wantsArchive });
				} catch {
					return denyAfterClaim(apiError({
						code: "VALIDATION_FAILED",
						message: t("apiShareToken.agentFileNeedsDirect", locale),
						status: 400,
					}));
				}
			}
			client = await connectSsh({
				host: credentials.host,
				port: credentials.port,
				username: credentials.username,
				hostKeySha256: credentials.hostKeySha256,
				// Fail closed on unpinned SFTP nodes, matching the terminal and
				// command channels — this path sends the stored credential.
				enforceHostKeyPin: true,
				agentServerId: credentials.agentServerId,
				privateKey: credentials.privateKey,
				passphrase: credentials.passphrase,
				password: credentials.password,
				readyTimeout: 15000,
				timeout: 10000,
			});
			if (wantsArchive) {
				if (share.entryType !== "DIRECTORY") {
					return denyAfterClaim(apiError({ code: "VALIDATION_FAILED", message: t("apiShareToken.notPackagable", locale), status: 400 }));
				}
				const archiveClient = client;
				const stream = await openManagedArchive({
					storageNodeId: node.id,
					relativePath: targetPath,
					signal: request.signal,
					// Windows OpenSSH runs bsdtar, as for the signed-in folder download.
					open: (excluded) => streamRemoteTarGz(archiveClient, remotePath, excluded, {
						bsdtar: node.server?.operatingSystem === "WINDOWS",
					}),
				});
				closeSshClientOnStreamEnd(stream, client);
				client = null;
				return archiveStreamResponse(stream, safeArchiveName(share.name || fileName));
			}
			const { stream, size } = await openSftpFile(client, remotePath);
			stream.on("close", () => client?.end());
			stream.on("error", () => client?.end());
			return fileResponse(stream, { size, fileName, inline: inline && !wantsArchive });
		} catch {
			client?.end();
			return denyAfterClaim(apiError({ code: "NOT_FOUND", message: t("apiShareToken.remoteNotFound", locale), status: 404 }));
		}
	}

	return denyAfterClaim(apiError({ code: "VALIDATION_FAILED", message: t("apiShareToken.unsupportedDriver", locale), status: 400 }));
}
