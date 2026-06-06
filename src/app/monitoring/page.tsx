import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { PermissionDenied } from "@/components/page-shell";
import MonitoringPageClient from "./monitoring-page-client";

export const dynamic = "force-dynamic";

export default async function MonitoringPage() {
	const session = await requireSession("/monitoring");
	if (!sessionHasPermission(session, "health:read")) return <PermissionDenied />;
	const canManage = sessionHasPermission(session, "docker:manage");
	return <MonitoringPageClient canManage={canManage} />;
}
