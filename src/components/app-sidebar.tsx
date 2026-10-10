"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { getAppName } from "@/lib/branding";
import { useI18n } from "@/lib/i18n/use-locale";
import { type Permission } from "@/lib/auth/rbac";
import { filterByHrefPermissions } from "@/lib/auth/filter-by-href-permissions";
import { useGateRoute } from "@/lib/auth/use-gate-route";
import { useDialogFocus } from "@/lib/a11y/use-dialog-focus";
import { useNavGroupState, useNavPins, useSidebarCollapsed } from "@/lib/ui/shell-preferences";
import { cn } from "@/lib/ui/cn";
import { UserMenu } from "./user-menu";
import { BrandTile, IconChevronRight, IconExternalLink, IconStar } from "./nav-icons";
import { X } from "./icons";
import { IconButton } from "./ui-primitives";
import {
	mainNavGroups,
	systemNavGroup,
	type AppNavGroup,
	type AppNavItem,
} from "./nav-items";

interface QuickServiceLink {
	slug: string;
	name: string;
	icon: string;
	path: string;
}

/** Event other chrome (top bar, mobile tab bar) uses to open the drawer. */
export const OPEN_MOBILE_NAV_EVENT = "vcontrolhub:open-mobile-nav";

function navLabel(
	t: (key: string, vars?: Record<string, string | number>) => string,
	item: { labelKey: string; fallbackLabel: string },
) {
	const translated = t(item.labelKey);
	return translated === item.labelKey ? item.fallbackLabel : translated;
}

function isActiveHref(pathname: string, href: string) {
	if (href === "/dashboard" && pathname === "/") return true;
	// Exact match, or a real nested route (/files/webdav), but not a sibling
	// prefix collision like /ai vs /ai-ops.
	return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({
	item,
	label,
	active,
	collapsed,
	pinned,
	onNavigate,
	onTogglePin,
	pinLabel,
}: {
	item: AppNavItem;
	label: string;
	active: boolean;
	collapsed: boolean;
	pinned: boolean;
	onNavigate: () => void;
	onTogglePin?: () => void;
	pinLabel?: string;
}) {
	return (
		<div className="group/item relative">
			<Link
				href={item.href}
				onClick={onNavigate}
				aria-current={active ? "page" : undefined}
				aria-label={collapsed ? label : undefined}
				title={collapsed ? label : undefined}
				className={cn(
					"relative flex min-h-8 min-w-0 items-center gap-2.5 rounded-md text-[13.5px] transition-colors duration-150",
					collapsed ? "mx-auto h-9 w-9 justify-center" : "px-2.5 py-1.5 pr-8",
					active
						? "bg-[var(--sidebar-active)] font-medium text-[var(--sidebar-active-fg)]"
						: "text-[var(--text-secondary)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--text-primary)]",
				)}
			>
				{active && !collapsed ? (
					<span aria-hidden="true" className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-[var(--accent)]" />
				) : null}
				<span className={cn("flex shrink-0 [&>svg]:h-[17px] [&>svg]:w-[17px]", active ? "text-[var(--accent)]" : "text-[var(--text-muted)] group-hover/item:text-[var(--text-secondary)]")}>
					{item.icon}
				</span>
				{collapsed ? null : <span className="min-w-0 flex-1 truncate">{label}</span>}
			</Link>
			{!collapsed && onTogglePin ? (
				<button
					type="button"
					onClick={onTogglePin}
					aria-label={pinLabel}
					aria-pressed={pinned}
					title={pinLabel}
					className={cn(
						"absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--warning)] focus-visible:opacity-100",
						pinned ? "text-[var(--warning)] opacity-100" : "opacity-0 group-hover/item:opacity-100",
					)}
				>
					<IconStar size={13} fill={pinned ? "currentColor" : "none"} />
				</button>
			) : null}
		</div>
	);
}

/** The daily core stays open until someone collapses it; other groups open on demand. */
const DEFAULT_OPEN_GROUPS = new Set(["overview", "servers", "files"]);

export function AppSidebar({
	username,
	quickServices = [],
	declaredPermissionsByHref = {},
	appName,
}: {
	username?: string;
	quickServices?: QuickServiceLink[];
	declaredPermissionsByHref?: Record<string, readonly Permission[]>;
	/** Server-resolved branding (env-backed) — see SidebarLoader; avoids a client/server hydration mismatch. */
	appName?: string;
	publicLabel?: string;
}) {
	const pathname = usePathname() ?? "/";
	const { t } = useI18n();
	const gate = useGateRoute();
	const collapsed = useSidebarCollapsed();
	const { pins, toggle: togglePin } = useNavPins();
	const { groups: storedGroups, setOpen: setGroupOpen } = useNavGroupState();
	const [mobileOpen, setMobileOpen] = useState(false);
	const mobileDialogRef = useDialogFocus<HTMLElement>({
		open: mobileOpen,
		onClose: () => setMobileOpen(false),
	});

	useEffect(() => {
		const open = () => setMobileOpen(true);
		window.addEventListener(OPEN_MOBILE_NAV_EVENT, open);
		const desktop = window.matchMedia?.("(min-width: 1024px)");
		const closeOnDesktop = () => { if (desktop?.matches) setMobileOpen(false); };
		desktop?.addEventListener("change", closeOnDesktop);
		return () => {
			window.removeEventListener(OPEN_MOBILE_NAV_EVENT, open);
			desktop?.removeEventListener("change", closeOnDesktop);
		};
	}, []);

	const visibleGroups = useMemo(() => {
		return [...mainNavGroups, systemNavGroup]
			.map((group) => ({
				...group,
				items: filterByHrefPermissions(group.items, declaredPermissionsByHref, gate.canAny),
			}))
			.filter((group) => group.items.length > 0);
	}, [declaredPermissionsByHref, gate]);

	const visibleItems = useMemo(() => visibleGroups.flatMap((group) => group.items), [visibleGroups]);
	const pinnedItems = useMemo(
		() => pins.map((href) => visibleItems.find((item) => item.href === href)).filter((item): item is AppNavItem => Boolean(item)),
		[pins, visibleItems],
	);

	if (!username) return null;

	const activeGroupId = visibleGroups.find((group) => group.items.some((item) => isActiveHref(pathname, item.href)))?.id;
	const isGroupOpen = (group: AppNavGroup) => storedGroups[group.id] ?? (group.id === activeGroupId || DEFAULT_OPEN_GROUPS.has(group.id));

	const renderNav = (mode: "desktop" | "mobile") => {
		const compact = mode === "desktop" && collapsed;
		const close = () => setMobileOpen(false);
		const link = (item: AppNavItem, inPinned = false) => {
			const label = navLabel(t, item);
			const pinned = pins.includes(item.href);
			return (
				<NavLink
					key={`${inPinned ? "pin:" : ""}${item.href}`}
					item={item}
					label={label}
					active={isActiveHref(pathname, item.href)}
					collapsed={compact}
					pinned={pinned}
					onNavigate={close}
					onTogglePin={() => togglePin(item.href)}
					pinLabel={t(pinned ? "shell.nav.unpin" : "shell.nav.pin", { page: label })}
				/>
			);
		};
		const section = (key: string, title: ReactNode, body: ReactNode, toggle?: { open: boolean; onToggle: () => void; count: number }) => (
			<div key={key} className={compact ? "border-t border-[var(--sidebar-border)] py-1.5 first:border-t-0" : "py-1"}>
				{compact ? null : toggle ? (
					<button
						type="button"
						onClick={toggle.onToggle}
						aria-expanded={toggle.open}
						aria-controls={`nav-group-${mode}-${key}`}
						className="group/heading flex h-7 w-full items-center gap-1 rounded-md px-2.5 text-left text-xs font-medium text-[var(--text-muted)] transition hover:text-[var(--text-secondary)]"
					>
						<span className="min-w-0 flex-1 truncate">{title}</span>
						<IconChevronRight size={13} className={cn("shrink-0 transition-transform duration-150", toggle.open && "rotate-90")} />
					</button>
				) : (
					<div className="flex h-7 items-center px-2.5 text-xs font-medium text-[var(--text-muted)]">{title}</div>
				)}
				{!toggle || toggle.open || compact ? (
					<div id={`nav-group-${mode}-${key}`} className={cn("space-y-px", compact && "flex flex-col items-center gap-0.5")}>
						{body}
					</div>
				) : null}
			</div>
		);
		return (
			<nav className="flex h-full w-full flex-col" data-i18n-skip aria-label={t("shell.sidebar.navigation")}>
				<div className={cn("flex h-[var(--topbar-height)] shrink-0 items-center gap-2.5", compact ? "justify-center px-2" : "px-4")}>
					<Link
						href="/dashboard"
						onClick={close}
						aria-label={t("shell.nav.home")}
						className="flex min-w-0 items-center gap-2.5 rounded-md outline-offset-4"
					>
						<BrandTile size={28} />
						{compact ? null : <span className="truncate text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">{appName ?? getAppName()}</span>}
					</Link>
					{mode === "mobile" ? (
						<IconButton label={t("common.close")} onClick={close} className="ml-auto shrink-0">
							<X size={18} aria-hidden />
						</IconButton>
					) : null}
				</div>

				<div data-nav-scroll className={cn("min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-3", compact ? "px-1.5" : "px-2.5")}>
					{pinnedItems.length > 0
						? section("pinned", t("shell.nav.pinned"), pinnedItems.map((item) => link(item, true)))
						: null}
					{visibleGroups.map((group) => {
						const open = isGroupOpen(group);
						return section(group.id, navLabel(t, group), group.items.map((item) => link(item)), {
							open,
							count: group.items.length,
							onToggle: () => setGroupOpen(group.id, !open),
						});
					})}
					{quickServices.length > 0 && !compact
						? section(
							"quick",
							t("nav.quickservice"),
							quickServices.map((service) => (
								<a
									key={service.slug}
									href={service.path}
									target="_blank"
									rel="noopener noreferrer"
									onClick={close}
									className="flex min-h-8 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13.5px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--sidebar-hover)] hover:text-[var(--text-primary)]"
								>
									<span className="w-[17px] shrink-0 text-center text-[15px] leading-none" aria-hidden="true">{service.icon}</span>
									<span className="min-w-0 flex-1 truncate" title={service.name}>
										{service.name}
									</span>
									<IconExternalLink size={12} className="shrink-0 text-[var(--text-muted)]" />
								</a>
							)),
						)
						: null}
				</div>

				<div className={cn("shrink-0 border-t border-[var(--sidebar-border)] py-2", compact ? "px-1.5" : "px-2.5")}>
					<UserMenu username={username} compact={compact} onNavigate={close} />
				</div>
			</nav>
		);
	};

	return (
		<>
			{mobileOpen && (
				<div
					className="fixed inset-0 z-40 bg-[var(--overlay)] backdrop-blur-[2px] lg:hidden"
					onClick={() => setMobileOpen(false)}
				/>
			)}

			<aside
				id="mobile-app-navigation"
				data-app-sidebar
				ref={mobileDialogRef}
				role={mobileOpen ? "dialog" : undefined}
				aria-modal={mobileOpen ? true : undefined}
				aria-label={t("nav.openMenu")}
				tabIndex={-1}
				inert={!mobileOpen}
				className={cn(
					"fixed inset-y-0 left-0 z-50 w-[min(17rem,86vw)] transform border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] shadow-[var(--shadow-lg)] transition-transform duration-200 lg:hidden",
					mobileOpen ? "translate-x-0" : "-translate-x-full",
				)}
			>
				{renderNav("mobile")}
			</aside>

			{/* Desktop spacer + fixed rail; width follows html[data-sidebar]. */}
			<div className="hidden w-[var(--sidebar-current)] shrink-0 transition-[width] duration-200 lg:block" aria-hidden="true" />
			<aside
				data-app-sidebar
				data-collapsed={collapsed || undefined}
				className="hidden h-dvh w-[var(--sidebar-current)] shrink-0 border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] transition-[width] duration-200 lg:fixed lg:inset-y-0 lg:left-0 lg:z-40 lg:flex"
			>
				{renderNav("desktop")}
			</aside>
		</>
	);
}
