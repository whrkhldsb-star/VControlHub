import { apiCopy } from "@/lib/i18n/api-copy";
import path from "node:path/posix";

import type { SessionPayload } from "@/lib/auth/session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { ForbiddenError } from "@/lib/errors";
import { sanitizeRemotePath } from "./sftp-service";
import { resolveRemoteRealPath } from "./client";
import { loadEnabledServerForSftp } from "./server-target";
import { createLogger } from "@/lib/logging";
import { t } from "@/lib/i18n/service-translations";

const logger = createLogger("sftp-access-control");

function isInsideRoot(candidate: string, root: string, windows: boolean) {
	const normalize = (value: string) => {
		// Windows OpenSSH accepts /C:/... and can return C:/... from realpath.
		const portable = windows ? value.replace(/\\/g, "/") : value;
		const absolute = windows && /^[a-z]:\//i.test(portable) ? `/${portable}` : portable;
		return path.normalize(absolute).replace(/\/+$/, "") || "/";
	};
	const normalizedRoot = normalize(root);
	const normalizedCandidate = normalize(candidate);
	// Relative paths execute from the remote login directory, which need not
	// equal the allowed root. Only absolute paths have unambiguous containment.
	if (!normalizedCandidate.startsWith("/")) return false;
	return normalizedCandidate === normalizedRoot ||
		normalizedCandidate.startsWith(normalizedRoot === "/" ? "/" : `${normalizedRoot}/`);
}

/**
 * Administrators can browse the whole SSH filesystem. Other server:ssh
 * operators are constrained to the Linux account home or Windows SFTP root.
 */
export async function assertSftpPathAccess(input: {
	session: SessionPayload;
	serverId: string;
	paths: string[];
}) {
	if (sessionHasPermission(input.session, "server:sftp:unrestricted")) return;

	const { server, ssh: params, rootPath: homeRoot } = await loadEnabledServerForSftp(input.serverId);
	const windows = server.operatingSystem === "WINDOWS";
	const safePaths = input.paths.map((rawPath) => sanitizeRemotePath(windows ? rawPath.replace(/\\/g, "/") : rawPath));
	for (const safePath of safePaths) {
		if (!isInsideRoot(safePath, homeRoot, windows)) {
			throw new ForbiddenError(apiCopy("apiCopy.sftp.path.is.outside.the.allowed.home.directory.c83fded2", { v0: String(homeRoot) }));
		}
	}

	async function canonicalPath(remotePath: string) {
		try {
			return await resolveRemoteRealPath({ ...params, remotePath });
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
	for (const safePath of safePaths) {
		const realPath = await canonicalPath(safePath);
		if (!isInsideRoot(realPath, realRoot, windows)) {
			throw new ForbiddenError(t("backend.sftp.outsideHome", { homeRoot }));
		}
	}
}
