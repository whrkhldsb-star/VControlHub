"use client";

import { useMemo, useState } from "react";
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
import {
	IconExternal,
	IconKey,
	mainNavGroups,
	systemNavItems,
	type AppNavGroup,
	type AppNavItem,
} from "./nav-items";

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

function navLabel(
	t: (key: string) => string,
	item: { labelKey: string; fallbackLabel: string },
) {
	const translated = t(item.labelKey);
	return translated === item.labelKey ? item.fallbackLabel : translated;
}

function SidebarControls() {
	const { t } = useI18n();
	const openGlobalSearch = () => {
		window.dispatchEvent(new Event("vcontrolhub:open-global-search"));
	};

	return (
		<div className="flex items-center gap-0.5">
			<button
				type="button"
				onClick={openGlobalSearch}
				className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-muted)] transition hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
				aria-label={t("search.dialog")}
				aria-keyshortcuts="Control+K Meta+K"
			>
				<svg width="18" height="18" className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
					<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
				</svg>
			</button>
			<LanguageToggle />
			<ThemeToggle />
			<NotificationBell />
		</div>
	);
}

function Chevron({ open }: { open: boolean }) {
	return (
		<svg
			width="14"
			height="14"
			viewBox="0 0 20 20"
			fill="none"
			className={`shrink-0 text-[var(--text-disabled)] transition-transform duration-150 ${open ? "rotate-90" : ""}`}
			aria-hidden="true"
		>
			<path d="M7 5l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
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
	const [filter, setFilter] = useState("");
	const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
	const shouldRenderSidebar = Boolean(username);
	const iconInitial = username?.trim().charAt(0).toUpperCase() ?? "";

	const visibleGroups = useMemo(() => {
		return mainNavGroups
			.map((group) => ({
				...group,
				items: filterByPermissions(group.items, declaredPermissionsByHref, gate.canAny),
			}))
			.filter((group) => group.items.length > 0);
	}, [declaredPermissionsByHref, gate]);

	const visibleSystemNav = useMemo(
		() => filterByPermissions(systemNavItems, declaredPermissionsByHref, gate.canAny),
		[declaredPermissionsByHref, gate],
	);

	if (!shouldRenderSidebar) return null;

	const isActive = (href: string) => {
		if (href === "/") return pathname === "/";
		return pathname.startsWith(href);
	};

	const filterNorm = filter.trim().toLowerCase();
	const matchesFilter = (item: AppNavItem) => {
		if (!filterNorm) return true;
		const label = navLabel(t, item).toLowerCase();
		return label.includes(filterNorm) || item.href.toLowerCase().includes(filterNorm);
	};

	const filteredGroups: AppNavGroup[] = visibleGroups
		.map((group) => ({ ...group, items: group.items.filter(matchesFilter) }))
		.filter((group) => group.items.length > 0);

	const filteredSystem = visibleSystemNav.filter(matchesFilter);
	const filteredQuick = quickServices.filter(
		(item) => !filterNorm || item.name.toLowerCase().includes(filterNorm),
	);

	const renderNavLink = (item: AppNavItem) => {
		const active = isActive(item.href);
		const label = navLabel(t, item);
		return (
			<Link
				key={item.href}
				href={item.href}
				onClick={() => setMobileOpen(false)}
				aria-current={active ? "page" : undefined}
				className={`group relative flex min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors duration-150 ${
					active
						? "bg-[var(--sidebar-active)] font-medium text-[var(--sidebar-active-fg)] shadow-[inset_3px_0_0_var(--accent)]"
						: "text-[var(--text-muted)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--text-secondary)]"
				}`}
			>
				<span className={`shrink-0 ${active ? "text-[var(--accent)]" : "text-[var(--text-disabled)] group-hover:text-[var(--text-muted)]"}`}>
					{item.icon}
				</span>
				<span className="min-w-0 flex-1 truncate" title={label}>
					{label}
				</span>
			</Link>
		);
	};

	const renderGroup = (group: AppNavGroup) => {
		const open = filterNorm ? true : openGroups[group.id] !== false;
		const title = navLabel(t, group);
		return (
			<div key={group.id} className="mb-1">
				<button
					type="button"
					onClick={() => setOpenGroups((prev) => ({ ...prev, [group.id]: !open }))}
					className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-disabled)] transition hover:bg-[var(--sidebar-hover)] hover:text-[var(--text-muted)]"
					aria-expanded={open}
				>
					<Chevron open={open} />
					<span className="min-w-0 flex-1 truncate">{title}</span>
					<span className="tabular-nums text-[10px] opacity-70">{group.items.length}</span>
				</button>
				{open ? <div className="mt-0.5 space-y-0.5 pl-0.5">{group.items.map(renderNavLink)}</div> : null}
			</div>
		);
	};

	const nav = (
		<nav className="flex h-full w-full flex-col" data-i18n-skip>
			<div className="border-b border-[var(--sidebar-border)] px-4 pb-3 pt-4">
				<div className="flex items-center gap-2.5">
					<div className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent)] shadow-[0_8px_24px_rgba(56,139,253,0.12)]">
						<svg width="18" height="18" className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
							<path d="M10.394 2.08a1 1 0 00-.788 0l-7 3a1 1 0 000 1.84L5.25 8.05 4.646 12.2a1 1 0 00.476 1.006l4.5 2.706a1 1 0 001.056 0l4.5-2.706a1 1 0 00.476-1.006L14.95 8.05l2.644-1.228a1 1 0 000-1.84l-7-3zM10 4.08l5.106 2.19L10 8.49 4.894 6.27 10 4.08z" />
						</svg>
					</div>
					<div className="min-w-0">
						<div className="truncate text-sm font-semibold tracking-tight text-[var(--text-primary)]">{getAppName()}</div>
						<p className="mt-0.5 truncate text-[11px] leading-none text-[var(--text-muted)]">{getPublicLabel()}</p>
					</div>
				</div>
				<label className="mt-3 block">
					<span className="sr-only">{t("nav.filter") === "nav.filter" ? "Filter menu" : t("nav.filter")}</span>
					<div className="relative">
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-disabled)]"
							aria-hidden="true"
						>
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
						</svg>
						<input
							type="search"
							value={filter}
							onChange={(e) => setFilter(e.target.value)}
							placeholder={t("nav.filter") === "nav.filter" ? "Filter menu…" : t("nav.filter")}
							className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-subtle)] py-2 pl-8 pr-2.5 text-xs text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-disabled)] focus:border-[var(--accent-border)] focus:bg-[var(--input-bg-focus)] focus:ring-2 focus:ring-[var(--input-ring)]"
						/>
					</div>
				</label>
			</div>

			<div className="min-w-0 flex-1 space-y-1 overflow-y-auto overflow-x-hidden px-2.5 py-3">
				{filteredGroups.map(renderGroup)}

				{filteredSystem.length > 0 && (
					<div className="mb-1 mt-2">
						<div className="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-disabled)]">
							{t("nav.system")}
						</div>
						<div className="space-y-0.5">{filteredSystem.map(renderNavLink)}</div>
					</div>
				)}

				{filteredQuick.length > 0 && (
					<div className="mb-1 mt-2">
						<div className="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-disabled)]">
							{t("nav.quickservice")}
						</div>
						<div className="space-y-0.5">
							{filteredQuick.map((item) => (
								<a
									key={item.slug}
									href={item.path}
									target="_blank"
									rel="noopener noreferrer"
									onClick={() => setMobileOpen(false)}
									className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--sidebar-hover)] hover:text-[var(--text-secondary)]"
								>
									<span className="shrink-0 text-[16px] leading-none">{item.icon}</span>
									<span className="min-w-0 flex-1 truncate" title={item.name}>
										{item.name}
									</span>
									<IconExternal />
								</a>
							))}
						</div>
					</div>
				)}

				{filterNorm && filteredGroups.length === 0 && filteredSystem.length === 0 && filteredQuick.length === 0 ? (
					<p className="px-3 py-6 text-center text-xs text-[var(--text-muted)]">
						{t("nav.filterEmpty") === "nav.filterEmpty" ? "No matching pages" : t("nav.filterEmpty")}
					</p>
				) : null}
			</div>

			<div className="space-y-1 border-t border-[var(--sidebar-border)] bg-[color-mix(in_srgb,var(--surface)_40%,transparent)] px-3 py-3">
				<div className="flex items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] px-2.5 py-2">
					<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent-bg)] text-xs font-semibold uppercase text-[var(--accent)]">
						{iconInitial}
					</div>
					<span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--text-secondary)]" title={username}>
						{username}
					</span>
					<SidebarControls />
				</div>
				<button
					type="button"
					onClick={() => {
						setPasswordModalOpen(true);
						setMobileOpen(false);
					}}
					className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--sidebar-hover)] hover:text-[var(--text-secondary)]"
				>
					<IconKey />
					<span>{t("auth.change-password")}</span>
				</button>
				<div className="px-1 py-0.5">
					<SignOutButton />
				</div>
			</div>
		</nav>
	);

	return (
		<>
			<button
				type="button"
				onClick={() => setMobileOpen(true)}
				className="fixed left-4 top-4 z-50 rounded-xl border border-[var(--border)] bg-[var(--surface)]/90 p-2.5 text-[var(--text-secondary)] shadow-[var(--shadow-md)] backdrop-blur transition hover:bg-[var(--surface-elevated)] lg:hidden"
				aria-label={t("nav.openMenu")}
			>
				<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
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
				className={`fixed inset-y-0 left-0 z-50 w-[min(17.5rem,88vw)] transform border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] shadow-[var(--shadow-lg)] transition-transform duration-200 lg:hidden ${
					mobileOpen ? "translate-x-0" : "-translate-x-full"
				}`}
			>
				{nav}
			</aside>

			{/* Desktop spacer + fixed rail */}
			<div className="hidden w-[17.5rem] shrink-0 bg-[var(--sidebar-bg)] lg:block" aria-hidden="true" />
			<aside className="hidden h-screen w-[17.5rem] shrink-0 border-r border-[var(--sidebar-border)] bg-[color-mix(in_srgb,var(--sidebar-bg)_96%,transparent)] shadow-[12px_0_40px_rgba(0,0,0,0.08)] backdrop-blur-xl lg:fixed lg:inset-y-0 lg:left-0 lg:z-40 lg:flex">
				{nav}
			</aside>

			<ChangePasswordModal open={passwordModalOpen} onClose={() => setPasswordModalOpen(false)} />
		</>
	);
}
