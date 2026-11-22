import { SFTP_TRANSFER_IDLE_TIMEOUT_MS } from "@/lib/ssh/sftp-timeout";
import { openManagedArchive } from "@/lib/storage/archive-access";
import { openManagedLocalFile, pinLocalArchiveDirectory } from "@/lib/storage/open-local-file";
import { lockStorageFileOverwrite } from "@/lib/storage/file-overwrite-lock";
import path from "node:path";
import { Readable } from "node:stream";
import { guessContentType } from "@/lib/http/mime-types";
import { Client } from "ssh2";
import { z } from "zod";

import { connectSsh, readRemoteFile, statRemoteEntry } from "@/lib/ssh/client";
import {
	archiveStreamResponse,
	buildArchiveHeaders,
	closeSshClientOnStreamEnd,
	safeArchiveName,
	streamLocalTarGz,
	streamRemoteTarGz,
	supportsRemoteTar,
} from "@/lib/storage/archive-stream";
import { buildContentDisposition } from "@/lib/http/content-disposition";
import { nodeStreamToWeb } from "@/lib/http/node-to-web-stream";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import {
	assertShareTargetNotDeleted,
	assertShareStillAt,
	recordShareDownload,
	shareIgnoresCase,
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
import { withApiCopyLocale } from "@/lib/i18n/api-copy";
import { getServerLocale, t, type Locale } from "@/lib/i18n/translations";
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

function shareTokenLimit(tokenHash: string): RateLimitConfig {
	return { bucketKey: `share-access:${tokenHash}`, maxRequests: 60, windowMs: 60_000 };
}
const SHARE_PASSWORD_LIMIT: RateLimitConfig = { maxRequests: 8, windowMs: 15 * 60_000 };
/** Guesses one client may make across every share: made-up tokens count too, so they cannot buy fresh per-share budgets. */
const SHARE_PASSWORD_CLIENT_LIMIT: RateLimitConfig = { maxRequests: 40, windowMs: 15 * 60_000 };
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
async function checkSharePasswordRateLimit(clientIp: string, tokenHash: string) {
	// The per-client budget is checked first and in its own namespace: its keys grow only with the number of
	// clients, so requests for made-up tokens cannot evict it, and they spend it like any other guess.
	const client = await checkRateLimitAsync(`share-password-client:${clientIp}`, SHARE_PASSWORD_CLIENT_LIMIT);
	if (!client.allowed) return client;
	return checkRateLimitAsync(`share-password:${tokenHash}:${clientIp}`, SHARE_PASSWORD_LIMIT);
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
	context: { params: Promise<{ token: string }> },
) {
	// The share service words its refusals with the backend copy, which reads its language from here. Without it
	// those were Chinese for every visitor ("访问密码错误" on an English installation).
	const locale = await getServerLocale();
	return withApiCopyLocale(locale, () => authorizeShare(request, context, locale));
}

async function authorizeShare(
	request: Request,
	{ params }: { params: Promise<{ token: string }> },
	locale: Locale,
) {
	const { token } = await params;
	const tokenHash = hashShareToken(token);
	const tokenRateLimit = await withRateLimit(request, shareTokenLimit(tokenHash));
	if (!tokenRateLimit.allowed) return rateLimitResponse(tokenRateLimit.retryAfterMs);
	if (!token || token.length < 10) {
		return apiError({ code: "VALIDATION_FAILED", message: t("apiShareToken.invalidToken", locale), status: 400 });
	}
	const parsed = await parsePasswordAuthorization(request);
	if (!parsed.success) {
		return apiError({ code: "VALIDATION_FAILED", message: t("backend.shareLink.passwordRequired", locale), status: 400 });
	}

	const clientIp = getClientIp(request);
	const passwordLimit = await checkSharePasswordRateLimit(clientIp, tokenHash);
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
			tokenHash,
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
			sftp.open(remotePath, "r", (openError, handle) => {
				if (openError) return reject(openError);
				sftp.fstat(handle, (statErr, stats) => {
					if (statErr || !stats.isFile()) {
						sftp.close(handle, () => {});
						return reject(statErr ?? new Error("Missing share target"));
					}
					resolve({ stream: sftp.createReadStream(remotePath, { handle }) as import("stream").Readable, size: stats.size });
				});
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
	// Same rule as storage/streaming.ts (A4-24): `default-src 'none'` blanks a
	// directly opened image/video (the MediaDocument's own fetch is blocked), and a
	// sandboxed document blocks the browser's PDF viewer. Inline media keeps the
	// bare sandbox; a PDF keeps only the framing rule; everything else stays locked.
	const inlinePdf = safeInline && /^application\/pdf\b/i.test(guessContentType(input.fileName));
	headers.set(
		"content-security-policy",
		!safeInline ? "sandbox; default-src 'none'; frame-ancestors 'none'" : inlinePdf ? "frame-ancestors 'none'" : "sandbox; frame-ancestors 'none'",
	);
	headers.set("referrer-policy", "no-referrer");
	headers.set("content-disposition", buildContentDisposition(safeInline ? "inline" : "attachment", input.fileName));
	return headers;
}

function fileResponse(stream: import("stream").Readable, input: { size: number; fileName: string; inline?: boolean }, idleTimeoutMs?: number) {
	return new Response(nodeStreamToWeb(stream, idleTimeoutMs), { status: 200, headers: fileHeaders(input) });
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
	context: { params: Promise<{ token: string }> },
	head: boolean,
) {
	// As in POST: the language of the share service's refusals.
	const locale = await getServerLocale();
	return withApiCopyLocale(locale, () => serveShareIn(request, context, head, locale));
}

async function serveShareIn(
	request: Request,
	{ params }: { params: Promise<{ token: string }> },
	head: boolean,
	locale: Locale,
) {
	const { token } = await params;
	const tokenHash = hashShareToken(token);
	const tokenRateLimit = await withRateLimit(request, shareTokenLimit(tokenHash));
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
		const authorizedShareId = ticket ? verifyShareDownloadTicket(ticket, tokenHash) : null;
		if (password) {
			const passwordLimit = await checkSharePasswordRateLimit(clientIp, tokenHash);
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

	let release: (() => Promise<void>) | undefined;
	try {
		release = await lockStorageFileOverwrite(share.storageNodeId, share.path);
		await assertShareStillAt(share.id, share.storageNodeId, share.path);
		const response = await openShareResponse(share, request, head, locale);
		if (!head) {
			if (response.ok) await recordShareDownload(share.id, clientIp ?? undefined, request.headers.get("user-agent") ?? undefined);
			else await releaseShareQuotaClaim(share.id);
		}
		return response;
	} catch {
		if (!head) await releaseShareQuotaClaim(share.id);
		return apiError({ code: "NOT_FOUND", message: t("apiShareToken.invalidToken", locale), status: 404 });
	} finally { await release?.(); }
}

async function openShareResponse(share: Awaited<ReturnType<typeof resolveShareToken>>, request: Request, head: boolean, locale: Locale) {
	const node = share.storageNode;
	const ignoreCase = shareIgnoresCase(node);
	let targetPath = share.path;
	let query: { path?: string; archive: boolean; inline: boolean };
	try {
		query = parseSearchParams(
			request,
			z.object({
				path: z.string().regex(/\S/).optional(),
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
		return apiError({ code: "VALIDATION_FAILED", message: err.message, status: 400 });
	}
	const { path: childPath, archive, inline } = query;
	const wantsArchive = archive;
	if (wantsArchive && share.entryType !== "DIRECTORY") {
		return apiError({ code: "VALIDATION_FAILED", message: t("apiShareToken.notPackagable", locale), status: 400 });
	}
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
			const rootParts = share.path.split("/");
			const childParts = targetPath.split("/");
			const inShare = rootParts.every((part, index) => ignoreCase
				? part.toLowerCase() === childParts[index]?.toLowerCase()
				: part === childParts[index]);
			if (!inShare) {
				return apiError({ code: "FORBIDDEN", message: t("apiShareToken.outOfRange", locale), status: 403 });
			}
			// Keep the granted root's spelling even if a Windows directory enables per-folder case sensitivity.
			targetPath = [...rootParts, ...childParts.slice(rootParts.length)].join("/");
		}
	} else if (share.entryType !== "FILE") {
		return apiError({ code: "VALIDATION_FAILED", message: t("apiShareToken.notDownloadable", locale), status: 400 });
	}
	try {
		await assertShareTargetNotDeleted(share.storageNodeId, targetPath, node.driver, ignoreCase);
	} catch {
		return apiError({ code: "NOT_FOUND", message: t("apiShareToken.invalidToken", locale), status: 404 });
	}

	if (wantsArchive && node.driver === "SFTP" && !supportsRemoteTar(node)) {
		return apiError({ code: "VALIDATION_FAILED", message: t("backend.storage.archiveNeedsLinuxSsh", locale), status: 400 });
	}
	const fileName = targetPath.split("/").pop() || share.name || targetPath;
	const headResponse = (size?: number) => new Response(null, { headers: wantsArchive
		? buildArchiveHeaders(safeArchiveName(share.name || fileName)) : fileHeaders({ fileName, size, inline }) });

	if (node.driver === "WEBDAV" || node.driver === "AGENT") {
		if (wantsArchive) return apiError({ code: "VALIDATION_FAILED", message: t("apiShareToken.unsupportedDriver", locale), status: 400 });
		try {
			if (head) {
				const { createRemoteStorageClient } = await import("@/lib/storage/agent-file-client");
				const entry = await createRemoteStorageClient({ ...node, expectedRoot: share.agentRootIdentity ?? undefined }).stat(targetPath, true);
				if (!entry || entry.isDirectory) throw new Error("Missing share target");
				return headResponse(entry.size);
			}
			const { streamStorageFile } = await import("@/lib/storage/file-content");
			const opened = await streamStorageFile({ ...node, expectedRoot: share.agentRootIdentity ?? undefined }, targetPath);
			const stream = opened.stream as Readable;
			stream.once("close", opened.close);
			stream.once("error", opened.close);
			return fileResponse(stream, { size: opened.size, fileName, inline });
		} catch {
			return apiError({ code: "NOT_FOUND", message: t("apiShareToken.remoteNotFound", locale), status: 404 });
		}
	}

	if (node.driver === "LOCAL") {
		const resolved = resolveStoragePathWithinBase(node.basePath, targetPath);
		if (!resolved.ok) {
			return apiError({ code: "VALIDATION_FAILED", message: t("apiShareToken.invalidPath", locale), status: 400 });
		}
		const absolutePath = resolved.path;
		try {
			if (wantsArchive) {
				if (head) {
					const pinned = await pinLocalArchiveDirectory(node.basePath, targetPath);
					await pinned.close();
					return headResponse();
				}
				const stream = await openManagedArchive({
					storageNodeId: node.id,
					caseInsensitive: ignoreCase,
					relativePath: targetPath,
					signal: request.signal,
					open: async excluded => {
						const pinned = await pinLocalArchiveDirectory(node.basePath, targetPath);
						try {
							return streamLocalTarGz(pinned.cwd ?? absolutePath, path.basename(absolutePath), excluded, pinned);
						} catch (error) {
							await pinned.close();
							throw error;
						}
					},
				});
				return archiveStreamResponse(stream, safeArchiveName(share.name || path.basename(absolutePath)));
			}
			const handle = await openManagedLocalFile(node.basePath, targetPath);
			try {
				const { size } = await handle.stat();
				if (head) { await handle.close(); return headResponse(size); }
				return fileResponse(handle.createReadStream(), { size, fileName, inline });
			} catch (error) { await handle.close(); throw error; }
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
			return apiError({ code: "VALIDATION_FAILED", message: getErrorMessage(err, t("apiShareToken.missingRemoteCredentials", locale)), status: 400 });
		}
		let client: Client | null = null;
		try {
			const agentOnly = Boolean(
				credentials.agentServerId && !credentials.privateKey && !credentials.password,
			);
			if (agentOnly) {
				if (wantsArchive) {
					return apiError({
						code: "VALIDATION_FAILED",
						message: t("apiShareToken.agentArchiveNeedsDirect", locale),
						status: 400,
					});
				}
				try {
					remotePath = await assertRemotePathContained(credentials, node.basePath, remotePath);
					if (head) {
						const entry = await statRemoteEntry({ ...credentials, remotePath });
						if (entry.type !== "file") throw new Error("Missing share target");
						return headResponse(entry.size);
					}
					const buffer = await readRemoteFile({ ...credentials, remotePath });
					return fileResponse(Readable.from(buffer), { size: buffer.length, fileName, inline: inline && !wantsArchive });
				} catch {
					return apiError({
						code: "VALIDATION_FAILED",
						message: t("apiShareToken.agentFileNeedsDirect", locale),
						status: 400,
					});
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
			remotePath = await assertRemotePathContained(credentials, node.basePath, remotePath, client);
			if (head) {
				const entry = await statRemoteEntry({ ...credentials, remotePath });
				if (entry.type !== (wantsArchive ? "directory" : "file")) throw new Error("Missing share target");
				return headResponse(entry.size);
			}
			if (wantsArchive) {
				const archiveClient = client;
				const stream = await openManagedArchive({
					storageNodeId: node.id,
					relativePath: targetPath,
					signal: request.signal,
					open: (excluded) => streamRemoteTarGz(archiveClient, node, remotePath, excluded, request.signal),
				});
				const response = archiveStreamResponse(stream, safeArchiveName(share.name || fileName));
				closeSshClientOnStreamEnd(stream, client);
				client = null;
				return response;
			}
			const { stream, size } = await openSftpFile(client, remotePath);
			const response = fileResponse(stream, { size, fileName, inline }, SFTP_TRANSFER_IDLE_TIMEOUT_MS);
			closeSshClientOnStreamEnd(stream, client);
			client = null;
			return response;
		} catch (error) {
			if (error instanceof ValidationError) return apiError({ code: "VALIDATION_FAILED", message: t("apiShareToken.invalidPath", locale), status: 400 });
			return apiError({ code: "NOT_FOUND", message: t("apiShareToken.remoteNotFound", locale), status: 404 });
		} finally {
			client?.end();
		}
	}

	return apiError({ code: "VALIDATION_FAILED", message: t("apiShareToken.unsupportedDriver", locale), status: 400 });
}
