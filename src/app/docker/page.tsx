import { requirePagePermission } from "@/lib/auth/page-guard";
import { listServerProfiles } from "@/lib/server/service-profiles";
import DockerPageClient from "./docker-page-client";

export default async function DockerPage() {
  await requirePagePermission("docker:manage");
  const servers = await listServerProfiles();
  const serverOptions = servers
    .filter((s) => s.enabled)
    .map((s) => ({ id: s.id, name: s.name, host: s.host }));
  return <DockerPageClient initialServers={serverOptions} />;
}
