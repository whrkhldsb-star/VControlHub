import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { PermissionDenied } from "@/components/page-shell";
import TrafficPageClient from "./traffic-page-client";

export default async function TrafficPage() {
  const session = await requireSession("/traffic");
  if (!sessionHasPermission(session, "server:read")) return <PermissionDenied />;
  return <TrafficPageClient />;
}
