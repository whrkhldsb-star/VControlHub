"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";

import { filterByHrefPermissions } from "@/lib/auth/filter-by-href-permissions";
import type { Permission } from "@/lib/auth/rbac";
import { useGateRoute } from "@/lib/auth/use-gate-route";
import { useI18n } from "@/lib/i18n/use-locale";
import { cn } from "@/lib/ui/cn";
import { OPEN_MOBILE_NAV_EVENT } from "./app-sidebar";
import { IconLayoutGrid } from "./nav-icons";
import { mobileNavItems } from "./nav-items";

export function getMobileNavTabs() {
	return mobileNavItems;
}

export function MobileNav({
	declaredPermissionsByHref = {},
}: {
	declaredPermissionsByHref?: Record<string, readonly Permission[]>;
} = {}) {
	const pathname = usePathname() ?? "/";
	const { t } = useI18n();
	const gate = useGateRoute();
	const visibleTabs = useMemo(
		() => filterByHrefPermissions(mobileNavItems, declaredPermissionsByHref, gate.canAny),
		[declaredPermissionsByHref, gate],
	);

	const tabClass = (active: boolean) =>
		cn(
			"flex min-h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1 transition",
			active ? "text-[var(--accent)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]",
		);

	return (
		<nav
			aria-label={t("nav.mobile")}
			data-i18n-skip
			className="fixed bottom-0 left-0 right-0 z-30 border-t border-[var(--border)] bg-[var(--topbar-bg)] px-2 pb-[calc(0.25rem+env(safe-area-inset-bottom))] pt-1 backdrop-blur-md lg:hidden"
		>
			<div
				className="grid w-full items-center gap-1"
				style={{ gridTemplateColumns: `repeat(${visibleTabs.length + 1}, minmax(0, 1fr))` }}
			>
				{visibleTabs.map((tab) => {
					const active = tab.href === "/"
						? pathname === "/"
						: pathname === tab.href || pathname.startsWith(`${tab.href}/`) || (tab.href === "/dashboard" && pathname === "/");
					const label = t(tab.labelKey) === tab.labelKey ? tab.fallbackLabel : t(tab.labelKey);
					return (
						<Link key={tab.href} href={tab.href} aria-current={active ? "page" : undefined} className={tabClass(active)}>
							<span className="[&>svg]:h-5 [&>svg]:w-5">{tab.icon}</span>
							<span className="max-w-full truncate text-[11px] leading-tight">{label}</span>
						</Link>
					);
				})}
				<button
					type="button"
					onClick={() => window.dispatchEvent(new Event(OPEN_MOBILE_NAV_EVENT))}
					aria-controls="mobile-app-navigation"
					className={tabClass(false)}
				>
					<IconLayoutGrid size={20} />
					<span className="text-[11px] leading-tight">{t("shell.nav.more")}</span>
				</button>
			</div>
		</nav>
	);
}
