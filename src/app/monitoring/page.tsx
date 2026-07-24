import { requirePagePermission } from "@/lib/auth/page-guard";
import MonitoringPageClient from "./monitoring-page-client";

export const dynamic = "force-dynamic";

export default async function MonitoringPage() {
	await requirePagePermission("health:read");
	return <MonitoringPageClient />;
}
