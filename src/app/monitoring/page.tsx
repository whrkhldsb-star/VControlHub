import { sessionHasPermission } from "@/lib/auth/authorization";
import { requirePagePermission } from "@/lib/auth/page-guard";
import MonitoringPageClient from "./monitoring-page-client";

export const dynamic = "force-dynamic";

export default async function MonitoringPage() {
	const session = await requirePagePermission("health:read");
	const canManage = sessionHasPermission(session, "docker:manage");
	return <MonitoringPageClient canManage={canManage} />;
}
