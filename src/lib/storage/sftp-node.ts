import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { resolveStorageSshCredentials } from "@/lib/storage/ssh-credentials";

export async function getSftpNodeConnection(nodeId: string) {
	const node = await prisma.storageNode.findUnique({
		where: { id: nodeId },
		select: {
			id: true,
			name: true,
			driver: true,
			basePath: true,
			host: true,
			port: true,
			username: true,
			serverId: true,
			server: {
				select: {
					id: true,
					host: true,
					port: true,
					username: true,
					connectionType: true,
					password: true,
					sshKey: { select: { privateKey: true } },
				},
			},
		},
	});
	if (!node) throw new NotFoundError("Storage node not found");
	if (node.driver !== "SFTP") throw new ValidationError("This node is not an SFTP storage node");
	try {
		return { node, credentials: resolveStorageSshCredentials(node) };
	} catch (error) {
		throw new ValidationError(error instanceof Error ? error.message : "Missing remote host address or connection credentials, cannot connect");
	}
}

