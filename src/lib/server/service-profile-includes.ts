import type { Prisma } from "@prisma/client";

export const SERVER_PROFILE_INCLUDE = {
  sshKey: {
    select: {
      id: true,
      name: true,
      fingerprint: true,
      publicKey: true,
      privateKey: true,
      passphrase: true,
      createdAt: true,
    },
  },
  storageNode: {
    select: {
      id: true,
      name: true,
      driver: true,
      isDefault: true,
      basePath: true,
      directAccessMode: true,
      publicBaseUrl: true,
      healthStatus: true,
    },
  },
  commandTargets: {
    select: {
      id: true,
      status: true,
      commandRequest: {
        select: {
          id: true,
          title: true,
          initiatedByType: true,
          status: true,
          createdAt: true,
        },
      },
    },
    orderBy: { commandRequest: { createdAt: "desc" } },
    take: 3,
  },
  metricSnapshots: {
    select: { isOnline: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 1,
  },
} as const;

/** Full server record as loaded by SERVER_PROFILE_INCLUDE (sshKey, storageNode, …). */
export type ServerProfileRecord = Prisma.ServerGetPayload<{ include: typeof SERVER_PROFILE_INCLUDE }>;
