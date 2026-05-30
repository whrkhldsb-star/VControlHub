import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { PermissionDenied } from "@/components/page-shell";
import DockerPageClient from "./docker-page-client";

export default async function DockerPage() {
  const session = await requireSession("/docker");
  if (!sessionHasPermission(session, "docker:manage")) return <PermissionDenied />;
  return <DockerPageClient />;
}
