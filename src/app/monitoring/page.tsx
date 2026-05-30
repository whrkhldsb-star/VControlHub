import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { PermissionDenied } from "@/components/page-shell";
import MonitoringPageClient from "./monitoring-page-client";

export default async function MonitoringPage() {
  const session = await requireSession("/monitoring");
  if (!sessionHasPermission(session, "health:read")) return <PermissionDenied />;
  return <MonitoringPageClient />;
}
