import { apiCopy } from "@/lib/i18n/api-copy";
import path from "node:path/posix";

import type { SessionPayload } from "@/lib/auth/session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { sanitizeRemotePath } from "./sftp-service";
import { buildSshParamsFromServer, resolveRemoteRealPath } from "./client";
import { createLogger } from "@/lib/logging";
import { t } from "@/lib/i18n/service-translations";

const logger = createLogger("sftp-access-control");

function isInsideRoot(candidate: string, root: string) {
	// Always resolve relative candidates against root, then re-normalize so
	// traversal sequences ("../") and doubled slashes cannot slip past the
	// prefix check. Use an exact root match or `${root}/` prefix — never a
	// bare startsWith(root) which would allow `/home/alice-evil` under `/home/alice`.
	const normalizedRoot = path.normalize(root.startsWith("/") ? root : `/${root}`);
	const absoluteCandidate = candidate.startsWith("/")
		? candidate
		: path.join(normalizedRoot, candidate);
	const normalizedCandidate = path.normalize(absoluteCandidate);
	return (
		normalizedCandidate === normalizedRoot ||
		normalizedCandidate.startsWith(`${normalizedRoot}/`)
	);
}

/**
 * Administrators can browse the whole SSH filesystem. Other server:ssh
 * operators are constrained to the configured SSH user's home directory.
 */
export async function assertSftpPathAccess(input: {
	session: SessionPayload;
	serverId: string;
	paths: string[];
}) {
	if (sessionHasPermission(input.session, "server:sftp:unrestricted")) return;

	const server = await prisma.server.findUnique({
		where: { id: input.serverId },
		select: {
			id: true,
			host: true,
			port: true,
			username: true,
			enabled: true,
			connectionType: true,
			password: true,
			managementMode: true,
			hostKeySha256: true,
			sshKey: { select: { privateKey: true, passphrase: true } },
		},
	});
	if (!server?.enabled) throw new NotFoundError(t("backend.ssh.serverNotFoundOrDisabled"));

	const homeRoot = server.username === "root" ? "/root" : `/home/${server.username}`;

	// Resolve SSH credentials once so we can canonicalise each path on the remote
	// host (symlink-free) before the containment check. A lexical check alone can
	// be defeated by a symlink inside the home dir (~/link -> /) that then reads
	// /etc/shadow via ~/link/etc/shadow.
	const params = await buildSshParamsFromServer(
		{
			id: server.id,
			host: server.host,
			port: server.port,
			username: server.username,
			connectionType: server.connectionType,
			sshKeyId: null,
			password: server.password,
			managementMode: server.managementMode,
			hostKeySha256: server.hostKeySha256,
		},
		server.sshKey,
	);

	for (const rawPath of input.paths) {
		const safePath = sanitizeRemotePath(rawPath);
		// First a cheap lexical check to reject the obvious before touching SSH.
		if (!isInsideRoot(safePath, homeRoot)) {
			throw new ForbiddenError(apiCopy("apiCopy.sftp.path.is.outside.the.allowed.home.directory.c83fded2", { v0: String(homeRoot) }));
		}
		// Then resolve symlinks on the host and re-check the canonical path.
		let realPath: string;
		try {
			realPath = await resolveRemoteRealPath({ ...params, remotePath: safePath });
		} catch (error) {
			// If we cannot canonicalise (transient SSH error), fail closed rather
			// than silently allowing a path we could not verify.
			logger.warn("sftp realpath resolution failed; denying restricted access", error, {
				serverId: input.serverId,
				path: safePath,
			});
			throw new ForbiddenError(t("backend.sftp.homeVerifyFailed", { homeRoot }));
		}
		if (!isInsideRoot(realPath, homeRoot)) {
			throw new ForbiddenError(t("backend.sftp.outsideHome", { homeRoot }));
		}
	}
}
