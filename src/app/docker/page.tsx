import { requirePagePermission } from "@/lib/auth/page-guard";
import { isGlobalTeamManager } from "@/lib/auth/team-scope";
import { listServerProfiles } from "@/lib/server/service-profiles";
import DockerPageClient from "./docker-page-client";

export default async function DockerPage() {
  const session = await requirePagePermission("docker:manage");
  const servers = await listServerProfiles(session);
  const serverOptions = servers
    .filter((s) => s.enabled)
    .map((s) => ({ id: s.id, name: s.name, host: s.host }));
  return (
    <DockerPageClient
      initialServers={serverOptions}
      canManageHubHost={isGlobalTeamManager(session)}
    />
  );
}
