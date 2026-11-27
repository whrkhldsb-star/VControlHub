import { requirePagePermission } from "@/lib/auth/page-guard";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { isGlobalTeamManager, serverTeamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { collectOptionPages } from "@/lib/server/option-pages";
import { listServerProfiles } from "@/lib/server/service-profiles";
import DockerPageClient from "./docker-page-client";

export default async function DockerPage() {
  const session = await requirePagePermission("docker:manage", { redirectTo: "/docker" });
  const servers = sessionHasPermission(session, "server:read")
    ? await listServerProfiles(session, { enabledOnly: true })
    : [];
  const installTargets = servers.length ? await collectOptionPages(page => prisma.server.findMany({
    where: { enabled: true, operatingSystem: "LINUX", ...serverTeamWhere(session, "manage") },
    orderBy: [{ name: "asc" }, { id: "asc" }], ...page, select: { id: true },
  })) : [];
  const installIds = new Set(installTargets.map(s => s.id));
  const serverOptions = servers.map((s) => ({ id: s.id, name: s.name, host: s.host, canInstall: installIds.has(s.id) }));
  return (
    <DockerPageClient
      initialServers={serverOptions}
      canReadDeployments={sessionHasPermission(session, "deploy:read")}
      canManageHubHost={isGlobalTeamManager(session)}
    />
  );
}
