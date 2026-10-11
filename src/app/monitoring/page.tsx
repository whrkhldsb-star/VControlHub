import { requirePlatformAdminPage } from "@/lib/auth/page-guard";
import MonitoringPageClient from "./monitoring-page-client";

export const dynamic = "force-dynamic";

/** Resources of the machine running VControlHub: platform administrators only. */
export default async function MonitoringPage() {
	await requirePlatformAdminPage({ redirectTo: "/monitoring" });
	return <MonitoringPageClient />;
}
