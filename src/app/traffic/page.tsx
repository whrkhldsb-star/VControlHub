import { requirePagePermission } from "@/lib/auth/page-guard";
import { isGlobalTeamManager } from "@/lib/auth/team-scope";
import TrafficPageClient from "./traffic-page-client";

export const dynamic = "force-dynamic";

export default async function TrafficPage() {
	const session = await requirePagePermission("server:read", { redirectTo: "/traffic" });
	return <TrafficPageClient showHubTraffic={isGlobalTeamManager(session)} />;
}
