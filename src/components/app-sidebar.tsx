"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { SignOutButton } from "./sign-out-button";
import { ChangePasswordModal } from "./change-password-modal";
import { NotificationBell } from "./notification-bell";
import { ThemeToggle } from "./theme-toggle";
import { LanguageToggle } from "./language-toggle";
import { getAppName, getPublicLabel } from "@/lib/branding";
import { useI18n } from "@/lib/i18n/use-locale";
import { type Permission } from "@/lib/auth/rbac";
import { useGateRoute } from "@/lib/auth/use-gate-route";
import { IconExternal, IconKey, mainNavItems, systemNavItems } from "./nav-items";

interface QuickServiceLink {
	slug: string;
	name: string;
	icon: string;
	path: string;
}

/**
 * Decide whether the current session is allowed to see a nav item.
 *
 * - `href` not present in the map → page does not declare any permission,
 *   visible to anyone authenticated.
 * - `href` declares `[]` permissions → same as above (explicit empty).
 * - `href` declares one or more permissions → user must hold at least one
 *   (`canAny`). Mirrors task 56's "无权限 UI 元素 完全不渲染" rule
 *   (TR-030 multi-tenant via permission-gated render).
 */
function filterByPermissions<T extends { href: string }>(
	items: readonly T[],
	declaredPermissionsByHref: Record<string, readonly Permission[]>,
	canAny: (permissions: readonly Permission[]) => boolean,
): T[] {
	return items.filter((item) => {
		const required = declaredPermissionsByHref[item.href];
		if (!required || required.length === 0) return true;
		return canAny(required);
	});
}

function SidebarControls() {
	const { t } = useI18n();
	const openGlobalSearch = () => {
		window.dispatchEvent(new Event("vcontrolhub:open-global-search"));
	};

	return (
		<div className="flex items-center gap-1">
			<button
				type="button"
				onClick={openGlobalSearch}
				className={`flex h-11 w-11 items-center justify-center rounded-lg text-[var(--text-muted)] transition hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]`}
				aria-label={t("search.dialog") === "search.dialog" ? "全局搜索" : t("search.dialog")}
				aria-keyshortcuts="Control+K Meta+K"
			>
				<span aria-hidden="true">⌕</span>
			</button>
			<LanguageToggle />
			<ThemeToggle />
			<NotificationBell />
		</div>
	);
}

export function AppSidebar({
	username,
	quickServices = [],
	declaredPermissionsByHref = {},
}: {
	username?: string;
	quickServices?: QuickServiceLink[];
	declaredPermissionsByHref?: Record<string, readonly Permission[]>;
}) {
	const pathname = usePathname();
	const { t } = useI18n();
	const gate = useGateRoute();
	const [mobileOpen, setMobileOpen] = useState(false);
	const [passwordModalOpen, setPasswordModalOpen] = useState(false);
	const shouldRenderSidebar = Boolean(username);
	const iconInitial = username?.trim().charAt(0).toUpperCase() ?? "";

	if (!shouldRenderSidebar) return null;

	const visibleMainNav = filterByPermissions(mainNavItems, declaredPermissionsByHref, gate.canAny);
	const visibleSystemNav = filterByPermissions(systemNavItems, declaredPermissionsByHref, gate.canAny);

	const isActive = (href: string) => {
		if (href === "/") return pathname === "/";
		return pathname.startsWith(href);
	};

	const renderNavLink = (item: (typeof mainNavItems)[number]) => {
		const active = isActive(item.href);
		return (
			<Link
				key={item.href}
				href={item.href}
				onClick={() => setMobileOpen(false)}
				className={`flex min-w-0 items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors duration-150 ${
					active
						? "bg-[var(--sidebar-active)] text-[var(--sidebar-active-fg)] font-medium"
						: "text-[var(--text-muted)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--text-secondary)]"
				}`}
			>
				<span className={active ? "text-[var(--accent)]" : "text-[var(--text-muted)]"}>{item.icon}</span>
				<span className="min-w-0 flex-1 truncate" title={t(item.labelKey) === item.labelKey ? item.fallbackLabel : t(item.labelKey)}>{t(item.labelKey) === item.labelKey ? item.fallbackLabel : t(item.labelKey)}</span>
			</Link>
		);
	};

	const nav = (
		<nav className="flex h-full w-full flex-col overflow-hidden" data-i18n-skip>
			<div className="border-b border-[var(--sidebar-border)] px-5 py-5">
				<div className="flex items-center gap-2.5">
					<div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent-bg)] text-[var(--accent)] border border-[var(--accent-border)]">
						<svg className="h-4.5 w-4.5" fill="currentColor" viewBox="0 0 20 20"><path d="M10.394 2.08a1 1 0 00-.788 0l-7 3a1 1 0 000 1.84L5.25 8.05 4.646 12.2a1 1 0 00.476 1.006l4.5 2.706a1 1 0 001.056 0l4.5-2.706a1 1 0 00.476-1.006L14.95 8.05l2.644-1.228a1 1 0 000-1.84l-7-3zM10 4.08l5.106 2.19L10 8.49 4.894 6.27 10 4.08z" /></svg>
					</div>
					<div className="min-w-0">
						<div className="truncate text-base font-semibold tracking-tight text-[var(--text-primary)]">{getAppName()}</div>
						<p className="mt-0.5 truncate text-[11px] leading-none text-[var(--text-muted)]">{getPublicLabel()}</p>
					</div>
				</div>
			</div>

			<div className="min-w-0 flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden px-3 py-4">
				{visibleMainNav.map(renderNavLink)}

				{visibleSystemNav.length > 0 && (
					<>
						<div className="px-3 pb-1 pt-4 text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--text-disabled)]">
								{t("nav.system") === "nav.system" ? "系统管理" : t("nav.system")}
							</div>
						{visibleSystemNav.map(renderNavLink)}
					</>
				)}

				{quickServices.length > 0 && (
					<>
						<div className="px-3 pb-1 pt-4 text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--text-disabled)]">
								{t("nav.quickservice") === "nav.quickservice" ? "快捷服务" : t("nav.quickservice")}
							</div>
							{quickServices.map((item) => (
								<a
									key={item.slug}
									href={item.path}
									target="_blank"
									rel="noopener noreferrer"
									onClick={() => setMobileOpen(false)}
									className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--sidebar-hover)] hover:text-[var(--text-secondary)]"
								>
								<span className="shrink-0 text-[18px] leading-none">{item.icon}</span>
								<span className="min-w-0 flex-1 truncate" title={item.name}>{item.name}</span>
								<IconExternal />
							</a>
						))}
					</>
				)}
			</div>

			<div className="space-y-1 border-t border-[var(--sidebar-border)] px-3 py-3">
				<div className="flex items-center gap-1 rounded-lg px-2 py-2 text-sm text-[var(--text-muted)]">
					<div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--surface-elevated)] text-[11px] font-semibold uppercase text-[var(--accent)]">
						{iconInitial}
					</div>
					<span className="min-w-0 flex-1 truncate text-xs" title={username}>{username}</span>
				</div>
				<div className="flex items-center justify-around px-1 py-1">
					<SidebarControls />
				</div>
				<button
					onClick={() => {
						setPasswordModalOpen(true);
						setMobileOpen(false);
					}}
					className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--sidebar-hover)] hover:text-[var(--text-secondary)]"
				>
					<IconKey />
					<span>{t("auth.change-password") === "auth.change-password" ? "修改密码" : t("auth.change-password")}</span>
				</button>
				<div className="px-2 py-1">
					<SignOutButton />
				</div>
			</div>
		</nav>
	);

	return (
		<>
			<button
				onClick={() => setMobileOpen(true)}
				className="fixed left-4 top-4 z-50 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5 text-[var(--text-secondary)] backdrop-blur transition hover:bg-[var(--surface-elevated)] lg:hidden"
				aria-label={t("nav.openMenu") === "nav.openMenu" ? "打开导航菜单" : t("nav.openMenu")}
			>
				<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
					<path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
				</svg>
			</button>

			{mobileOpen && (
				<div
					className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
					onClick={() => setMobileOpen(false)}
				/>
			)}

			<aside
				inert={!mobileOpen}
				className={`fixed inset-y-0 left-0 z-50 w-[min(18rem,86vw)] transform border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] transition-transform duration-200 lg:hidden ${
					mobileOpen ? "translate-x-0" : "-translate-x-full"
				}`}
			>
				{nav}
			</aside>

			<aside className="hidden h-screen w-72 shrink-0 overflow-hidden border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] lg:sticky lg:top-0 lg:flex">
				{nav}
			</aside>

			<ChangePasswordModal
				open={passwordModalOpen}
				onClose={() => setPasswordModalOpen(false)}
			/>
		</>
	);
}
