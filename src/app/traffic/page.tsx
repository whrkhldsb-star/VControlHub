import { requirePagePermission } from "@/lib/auth/page-guard";
import TrafficPageClient from "./traffic-page-client";

export const dynamic = "force-dynamic";

export default async function TrafficPage() {
	await requirePagePermission("server:read");
	return <TrafficPageClient />;
}
