import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { PermissionDenied } from "@/components/page-shell";
import TrafficPageClient from "./traffic-page-client";

export const dynamic = "force-dynamic";

export default async function TrafficPage() {
	const session = await requireSession("/traffic");
	if (!sessionHasPermission(session, "server:read")) return <PermissionDenied />;
	const canManage = sessionHasPermission(session, "server:write");
	return <TrafficPageClient canManage={canManage} />;
}
