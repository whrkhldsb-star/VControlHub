import path from "node:path/posix";

import type { SessionPayload } from "@/lib/auth/session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { sanitizeRemotePath } from "./sftp-service";

function isInsideRoot(candidate: string, root: string) {
	const normalizedCandidate = path.normalize(candidate.startsWith("/") ? candidate : `${root}/${candidate}`);
	const normalizedRoot = path.normalize(root);
	return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`);
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
		select: { username: true, enabled: true },
	});
	if (!server?.enabled) throw new NotFoundError("Server not found or disabled");

	const homeRoot = server.username === "root" ? "/root" : `/home/${server.username}`;
	for (const rawPath of input.paths) {
		const safePath = sanitizeRemotePath(rawPath);
		if (!isInsideRoot(safePath, homeRoot)) {
			throw new ForbiddenError(`SFTP path is outside the allowed home directory: ${homeRoot}`);
		}
	}
}
