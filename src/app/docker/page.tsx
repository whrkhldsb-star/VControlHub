import { requirePagePermission } from "@/lib/auth/page-guard";
import DockerPageClient from "./docker-page-client";

export default async function DockerPage() {
  await requirePagePermission("docker:manage");
  return <DockerPageClient />;
}
