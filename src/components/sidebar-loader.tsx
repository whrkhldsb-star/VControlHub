import { cookies } from "next/headers";

import { getSessionCookieName, verifySessionToken } from "@/lib/auth/session";

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

	return <AppSidebar username={username} />;
}
