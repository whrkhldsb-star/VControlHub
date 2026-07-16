import type { SessionPayload } from "@/lib/auth/session";
import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { resolveStorageSshCredentials } from "@/lib/storage/ssh-credentials";

const SFTP_NODE_SELECT = {
	id: true,
	name: true,
	driver: true,
	basePath: true,
	host: true,
	port: true,
	username: true,
	hostKeySha256: true,
	serverId: true,
	server: {
		select: {
			id: true,
			host: true,
			port: true,
			username: true,
			connectionType: true,
			password: true,
			hostKeySha256: true,
			sshKey: { select: { privateKey: true } },
		},
	},
} as const;

type TeamSession = Pick<SessionPayload, "userId" | "roles" | "currentTeamId">;

/**
 * Resolve an SFTP storage node (and decrypted SSH credentials) for remote ops.
 *
 * When `session` is provided, the node is loaded with `teamWhere` so a
 * team-scoped caller cannot open another team's StorageNode by id (IDOR).
 * Callers that already enforce a stronger boundary may omit session only when
 * the node id is known to be pre-scoped.
 */
export async function getSftpNodeConnection(
	nodeId: string,
	session?: TeamSession | null,
) {
	const node = await prisma.storageNode.findFirst({
		where: {
			id: nodeId,
			...(session ? teamWhere(session) : {}),
		},
		select: SFTP_NODE_SELECT,
	});
	if (!node) throw new NotFoundError("Storage node not found");
	if (node.driver !== "SFTP") throw new ValidationError("This node is not an SFTP storage node");
	try {
		return { node, credentials: resolveStorageSshCredentials(node) };
	} catch (error) {
		throw new ValidationError(error instanceof Error ? error.message : "Missing remote host address or connection credentials, cannot connect");
	}
}
