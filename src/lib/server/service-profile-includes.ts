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
      host: true,
      hostKeySha256: true,
      port: true,
      username: true,
      directAccessMode: true,
      publicBaseUrl: true,
      healthStatus: true,
      lastHealthyAt: true,
      lastHealthyTransport: true,
    },
  },
  commandTargets: {
    select: {
      id: true,
      status: true,
      executionChannel: true,
      fallbackReason: true,
      outcomeUnknown: true,
      commandRequest: {
        select: {
          id: true,
          title: true,
          initiatedByType: true,
          status: true,
          createdAt: true,
          teamId: true,
        },
      },
    },
    orderBy: { commandRequest: { createdAt: "desc" } },
    take: 3,
  },
  agentFileShares: { select: { teamId: true, lastReadAt: true, lastWriteAt: true, node: { select: { id: true, name: true, lastHealthyAt: true, teamId: true } } } },
  metricLatest: { select: { metricsAt: true, metricsSource: true } },
  metricSnapshots: {
    select: { isOnline: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 1,
  },
  team: { select: { name: true } },
} as const;

/** Full server record as loaded by SERVER_PROFILE_INCLUDE (sshKey, storageNode, …). */
export type ServerProfileRecord = Prisma.ServerGetPayload<{ include: typeof SERVER_PROFILE_INCLUDE }>;
