import { cookies } from "next/headers";

import { getSessionCookieName, verifySessionToken } from "@/lib/auth/session";
import { listQuickServices } from "@/lib/quick-service/service";

import { AppSidebar } from "@/components/app-sidebar";

export async function SidebarLoader() {
	const cookieStore = await cookies();
	const sessionCookie = cookieStore.get(getSessionCookieName());

	let username: string | undefined;
	if (sessionCookie?.value) {
		try {
			const payload = await verifySessionToken(sessionCookie.value);
			username = payload.username;
		} catch {
			// not logged in — sidebar will still render, just no username
		}
	}

	// 未登录时不显示侧栏（登录页等）
	if (!username) {
		return null;
	}

	// Fetch running quick services for sidebar
	let quickServices: Array<{ slug: string; name: string; icon: string; path: string }> = [];
	try {
		const all = await listQuickServices();
		quickServices = all
			.filter((s) => s.status === "running" && s.path)
			.map((s) => ({ slug: s.slug, name: s.name, icon: s.icon, path: s.path }));
	} catch {
		// DB may not be ready; skip
	}

	return <AppSidebar username={username} quickServices={quickServices} />;
}
