import type { Prisma, Server, StorageNode } from "@prisma/client";

/** The backend namespace in which a public link's relative path was authorized. */
export const storageRootSelect = {
  basePath: true, driver: true, host: true, port: true, username: true, serverId: true, webdavConfigEncrypted: true,
} as const;
export type StorageRoot = Pick<StorageNode, keyof typeof storageRootSelect>;

const rootFields = Object.keys(storageRootSelect) as (keyof StorageRoot)[];
export function sameStorageRoot(first: StorageRoot, second: StorageRoot): boolean {
  return rootFields.every((field) => first[field] === second[field]);
}

export function revokeNodeShares() {
  return { shareLinks: { updateMany: { where: { revokedAt: null }, data: { revokedAt: new Date() } } } };
}

type Endpoint = Pick<Server, "host" | "port" | "username">;

/** Run after updating the server, while its row lock prevents new shares from committing. */
export async function revokeInheritedSftpShares(
  tx: Prisma.TransactionClient, server: Endpoint & Pick<Server, "id" | "operatingSystem">, next: Endpoint,
) {
  const inherited: Prisma.StorageNodeWhereInput[] = [];
  if (server.host !== next.host) inherited.push({ host: null });
  // Windows stores its RDP port here. SFTP on those nodes defaults to 22.
  if (server.operatingSystem !== "WINDOWS" && server.port !== next.port) inherited.push({ port: null });
  if (server.username !== next.username) inherited.push({ username: null });
  if (inherited.length) await tx.shareLink.updateMany({
    where: { revokedAt: null, storageNode: { serverId: server.id, driver: "SFTP", OR: inherited } },
    data: { revokedAt: new Date() },
  });
}
