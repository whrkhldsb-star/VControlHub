import { apiCopy } from "@/lib/i18n/api-copy";
import { isInsideRoot } from "./sftp-root";

import type { SessionPayload } from "@/lib/auth/session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { ForbiddenError } from "@/lib/errors";
import { sanitizeRemotePath } from "./sftp-service";
import { resolveRemoteRealPath } from "./client";
import { loadEnabledServerForSftp } from "./server-target";
import { createLogger } from "@/lib/logging";
import { t } from "@/lib/i18n/service-translations";

const logger = createLogger("sftp-access-control");

/**
 * Administrators can browse the whole SSH filesystem. Other server:ssh
 * operators are constrained to the Linux account home or Windows SFTP root.
 */
export async function assertSftpPathAccess(input: {
	session: SessionPayload;
	serverId: string;
	paths: string[];
	signal?: AbortSignal;
	target?: Awaited<ReturnType<typeof loadEnabledServerForSftp>>;
}) {
	if (sessionHasPermission(input.session, "server:sftp:unrestricted")) return;

	const { server, ssh: params, rootPath: homeRoot, homeVerified } = input.target ?? await loadEnabledServerForSftp(input.serverId);
	if (homeVerified === false) throw new ForbiddenError(t("backend.sftp.homeVerifyFailed", { homeRoot: params.username }));
	const windows = server.operatingSystem === "WINDOWS";
	const safePaths = input.paths.map((rawPath) => sanitizeRemotePath(windows ? rawPath.replace(/\\/g, "/") : rawPath));
	for (const safePath of safePaths) {
		if (!isInsideRoot(safePath, homeRoot, windows)) {
			throw new ForbiddenError(apiCopy("apiCopy.sftp.path.is.outside.the.allowed.home.directory.c83fded2", { v0: String(homeRoot) }));
		}
	}

	async function canonicalPath(remotePath: string) {
		try {
			return await resolveRemoteRealPath({ ...params, remotePath, signal: input.signal });
		} catch (error) {
			logger.warn("sftp realpath resolution failed; denying restricted access", error, {
				serverId: input.serverId,
				path: remotePath,
			});
			throw new ForbiddenError(t("backend.sftp.homeVerifyFailed", { homeRoot }));
		}
	}

	// Compare both canonical paths so a legitimate symlinked home/root works,
	// while a link inside it pointing outside the root remains disallowed.
	const realRoot = await canonicalPath(homeRoot);
	const canonical: string[] = [];
	for (const safePath of safePaths) {
		const realPath = await canonicalPath(safePath);
		canonical.push(realPath);
		if (!isInsideRoot(realPath, realRoot, windows)) {
			throw new ForbiddenError(t("backend.sftp.outsideHome", { homeRoot }));
		}
	}
	return { path: realRoot, windows, canonical };
}
