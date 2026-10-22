import { requirePagePermission } from "@/lib/auth/page-guard";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { isGlobalTeamManager } from "@/lib/auth/team-scope";
import { listServerProfiles } from "@/lib/server/service-profiles";
import DockerPageClient from "./docker-page-client";

export default async function DockerPage() {
  const session = await requirePagePermission("docker:manage");
  const servers = sessionHasPermission(session, "server:read")
    ? await listServerProfiles(session, { enabledOnly: true })
    : [];
  const serverOptions = servers.map((s) => ({ id: s.id, name: s.name, host: s.host }));
  return (
    <DockerPageClient
      initialServers={serverOptions}
      canManageHubHost={isGlobalTeamManager(session)}
    />
  );
}
