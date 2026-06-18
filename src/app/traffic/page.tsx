import { sessionHasPermission } from "@/lib/auth/authorization";
import { requirePagePermission } from "@/lib/auth/page-guard";
import TrafficPageClient from "./traffic-page-client";

export const dynamic = "force-dynamic";

export default async function TrafficPage() {
	const session = await requirePagePermission("server:read");
	const canManage = sessionHasPermission(session, "server:write");
	return <TrafficPageClient canManage={canManage} />;
}
