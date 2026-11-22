import { Prisma } from "@prisma/client";
import type { SshEndpointIdentity } from "@/lib/ssh/server-connection-select";

export type HealthEndpoint = SshEndpointIdentity & { teamId: string | null; enabled: boolean };
/** Process-local evidence for cached reads and sampler writes. JSON responses omit symbol keys. */
export const sampledEndpoint = Symbol("sampledEndpoint");

type SampleSource = { serverId: string; [sampledEndpoint]?: HealthEndpoint };

/** SQL for the current servers (aliased s) that supplied these samples. */
export function sampledServerScope(samples: SampleSource[]) {
  const bound = samples.filter(sample => sample[sampledEndpoint]);
  if (!bound.length) return Prisma.empty;
  const predicates = samples.map(sample => {
    const endpoint = sample[sampledEndpoint];
    if (!endpoint) return Prisma.sql`s.id = ${sample.serverId}`;
    return Prisma.sql`(s.id = ${sample.serverId} AND s."teamId" IS NOT DISTINCT FROM ${endpoint.teamId}
      AND s.enabled = ${endpoint.enabled} AND s.host = ${endpoint.host} AND s.port = ${endpoint.port}
      AND s.username = ${endpoint.username} AND s."hostKeySha256" IS NOT DISTINCT FROM ${endpoint.hostKeySha256}
      AND s."managementMode"::text = ${endpoint.managementMode} AND s."agentTokenHash" IS NOT DISTINCT FROM ${endpoint.agentTokenHash})`;
  });
  return Prisma.sql`AND (${Prisma.join(predicates, " OR ")})
    AND NOT EXISTS (SELECT 1 FROM teams t WHERE t.id = s."teamId" AND t."deletedAt" IS NOT NULL)`;
}
