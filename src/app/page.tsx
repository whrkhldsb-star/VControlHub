import { redirect } from "next/navigation";

import { getCurrentSession } from "@/lib/auth/server-session";
import { loadPublicSite } from "@/lib/public-status/site";
import { DashboardContent } from "./dashboard-content";

export const dynamic = "force-dynamic";

export default async function Home() {
	// Visitors land on the public status board when an administrator opened
	// it; otherwise (and on any read failure) on the sign-in page as before.
	if (!(await getCurrentSession())) {
		const site = await loadPublicSite().catch(() => null);
		redirect(site?.enabled ? "/status" : "/login?next=%2F");
	}
	return DashboardContent({ sessionPath: "/" });
}
