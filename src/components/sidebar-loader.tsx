import { cookies, headers } from "next/headers";

import { getCurrentSession } from "@/lib/auth/server-session";
import { loadSidebarDeclaredPermissions } from "@/lib/auth/declared-permissions";
import { config } from "@/lib/config/env";
import { buildQuickServiceAccessUrl } from "@/lib/quick-service/access-url";
import { listQuickServices } from "@/lib/quick-service/service";
import { mainNavItems, systemNavItems } from "./nav-items";

import { AppSidebar } from "@/components/app-sidebar";

const sidebarHrefs = [...mainNavItems, ...systemNavItems].map((item) => item.href);

export async function SidebarLoader() {
	const session = await getCurrentSession();
	const username = session?.username;

	// 未登录时不显示侧栏（登录页等）
	if (!username) {
		return null;
	}

	// Fetch running quick services for sidebar
	let quickServices: Array<{ slug: string; name: string; icon: string; path: string }> = [];
	try {
		const headerStore = await headers();
		const browserHost = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
		const protocol = headerStore.get("x-forwarded-proto") ?? "http";
		const all = await listQuickServices();
		quickServices = all
			.filter((s) => s.status === "running" && s.port)
			.map((s) => {
				const accessUrl = buildQuickServiceAccessUrl({
					port: s.port,
					defaultPort: s.port ?? 80,
					browserHost,
					configuredHost: config.app.publicQuickServiceHost,
					protocol,
					path: s.path,
				});
				return accessUrl ? { slug: s.slug, name: s.name, icon: s.icon, path: accessUrl } : null;
			})
			.filter((s): s is { slug: string; name: string; icon: string; path: string } => Boolean(s));
	} catch {
		// DB may not be ready; skip
	}

	const declaredPermissionsByHref = loadSidebarDeclaredPermissions(sidebarHrefs);

	return (
		<AppSidebar
			username={username}
			quickServices={quickServices}
			declaredPermissionsByHref={declaredPermissionsByHref}
		/>
	);
}
