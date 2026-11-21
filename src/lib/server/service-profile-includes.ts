import { prisma } from "@/lib/db";
import { serverProfileTeamWhere } from "@/lib/auth/team-scope";
import type { SessionPayload } from "@/lib/auth/session";
import type { Prisma, Server } from "@prisma/client";

export const SERVER_PROFILE_INCLUDE = {
  sshKey: {
    select: {
      id: true,
      name: true,
      fingerprint: true,
      publicKey: true,
      teamId: true,
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
      teamId: true,
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

type ProfileBinding = Pick<Server, "teamId" | "host" | "port" | "username" | "managementMode">;
export function savedProfileBinding(saved: ProfileBinding) {
  return { teamId: saved.teamId, host: saved.host, port: saved.port, username: saved.username, managementMode: saved.managementMode };
}

/** Hydrate the profile on the pool, outside the transaction that writes it. */
export function findServerProfileForSession(
  serverId: string,
  session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId"> | null,
  binding?: ProfileBinding,
) {
  const where = { ...binding, id: serverId };
  return session
    ? prisma.server.findFirst({ where: { ...where, AND: serverProfileTeamWhere(session) }, include: SERVER_PROFILE_INCLUDE })
    : prisma.server.findUnique({ where, include: SERVER_PROFILE_INCLUDE });
}
