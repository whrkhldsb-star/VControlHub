"use client";

/**
 * Sticky top bar of the authenticated shell: where am I (breadcrumb), find
 * anything (search / ⌘K), what needs attention (notifications), and the
 * appearance toggles. It also records visited pages for the command palette
 * and names the browser tab after the current page.
 */
import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useI18n } from "@/lib/i18n/use-locale";
import { recordRecentPage, toggleSidebarCollapsed, useSidebarCollapsed } from "@/lib/ui/shell-preferences";
import { cn } from "@/lib/ui/cn";
import { OPEN_MOBILE_NAV_EVENT } from "./app-sidebar";
import { LanguageToggle } from "./language-toggle";
import { NotificationBell } from "./notification-bell";
import { ThemeToggle } from "./theme-toggle";
import { BrandTile, IconChevronRight, IconMenu, IconPanelLeft, IconSearch } from "./nav-icons";
import { findNavLocation } from "./nav-items";

type Crumb = { label: string; href?: string };

/** Pages below a navigation entry that deserve their own crumb. */
const SUB_CRUMBS: Array<[RegExp, string]> = [
	[/^\/files\/search(\/|$)/, "shell.crumb.filesSearch"],
	[/^\/files\/recycle-bin(\/|$)/, "shell.crumb.filesRecycleBin"],
	[/^\/files\/recent-downloads(\/|$)/, "shell.crumb.filesRecentDownloads"],
	[/^\/files\/sync(\/|$)/, "shell.crumb.filesSync"],
	[/^\/files\/webdav(\/|$)/, "shell.crumb.filesWebdav"],
	[/^\/files\/preview(\/|$)/, "shell.crumb.filesPreview"],
	[/^\/servers\/[^/]+\/remote-desktop/, "shell.crumb.remoteDesktop"],
	[/^\/(tickets|media)\/[^/]+$/, "shell.crumb.detail"],
];

const ACCOUNT_CRUMBS: Record<string, string> = {
	"/account/security": "shell.crumb.accountSecurity",
	"/account/password": "shell.crumb.accountPassword",
};

function useCrumbs(pathname: string): Crumb[] {
	const { t } = useI18n();
	const label = (key: string, fallback: string) => {
		const value = t(key);
		return value === key ? fallback : value;
	};
	if (ACCOUNT_CRUMBS[pathname]) {
		return [{ label: t("shell.crumb.account") }, { label: t(ACCOUNT_CRUMBS[pathname]) }];
	}
	const location = findNavLocation(pathname);
	if (!location) return [];
	const crumbs: Crumb[] = [
		{ label: label(location.group.labelKey, location.group.fallbackLabel) },
		{ label: label(location.item.labelKey, location.item.fallbackLabel), href: location.item.href },
	];
	const sub = SUB_CRUMBS.find(([pattern]) => pattern.test(pathname));
	if (sub) crumbs.push({ label: t(sub[1]) });
	return crumbs;
}

export function AppTopbar({ appName }: { appName: string }) {
	const pathname = usePathname() ?? "/";
	const { t } = useI18n();
	const collapsed = useSidebarCollapsed();
	const crumbs = useCrumbs(pathname);
	const leaf = crumbs.at(-1)?.label;

	useEffect(() => {
		const location = findNavLocation(pathname);
		if (location) recordRecentPage(location.item.href);
	}, [pathname]);

	useEffect(() => {
		document.title = leaf ? `${leaf} · ${appName}` : appName;
	}, [leaf, appName]);

	const openSearch = () => window.dispatchEvent(new Event("vcontrolhub:open-global-search"));

	return (
		<header
			data-topbar
			className="sticky top-0 z-30 flex h-[var(--topbar-height)] min-w-0 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--topbar-bg)] px-3 backdrop-blur-md sm:px-4 lg:px-5"
		>
			<button
				type="button"
				onClick={() => window.dispatchEvent(new Event(OPEN_MOBILE_NAV_EVENT))}
				className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] lg:hidden"
				aria-label={t("nav.openMenu")}
				aria-controls="mobile-app-navigation"
			>
				<IconMenu size={18} />
			</button>
			<Link
				href="/dashboard"
				aria-label={t("shell.nav.home")}
				className="shrink-0 rounded-lg lg:hidden"
			>
				<BrandTile size={28} />
			</Link>
			<button
				type="button"
				onClick={toggleSidebarCollapsed}
				className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] lg:flex"
				aria-label={t(collapsed ? "shell.sidebar.expand" : "shell.sidebar.collapse")}
				title={`${t(collapsed ? "shell.sidebar.expand" : "shell.sidebar.collapse")}  [`}
				aria-keyshortcuts="["
				aria-pressed={collapsed}
			>
				<IconPanelLeft size={17} />
			</button>
			<span aria-hidden="true" className="hidden h-4 w-px bg-[var(--border)] lg:block" />

			<nav aria-label={t("shell.breadcrumb")} className="min-w-0 flex-1">
				<ol className="flex min-w-0 items-center gap-1 text-[13.5px]">
					{crumbs.map((crumb, index) => {
						const last = index === crumbs.length - 1;
						return (
							<li key={`${index}-${crumb.label}`} className={cn("flex min-w-0 items-center gap-1", !last && "max-sm:hidden")}>
								{index > 0 ? <IconChevronRight size={13} className="shrink-0 text-[var(--text-disabled)] max-sm:hidden" /> : null}
								{crumb.href && !last ? (
									<Link href={crumb.href} className="truncate text-[var(--text-muted)] transition hover:text-[var(--text-primary)]">
										{crumb.label}
									</Link>
								) : (
									<span
										aria-current={last ? "page" : undefined}
										className={cn("truncate", last ? "font-medium text-[var(--text-primary)]" : "text-[var(--text-muted)]")}
									>
										{crumb.label}
									</span>
								)}
							</li>
						);
					})}
				</ol>
			</nav>

			<button
				type="button"
				onClick={openSearch}
				aria-label={t("search.dialog")}
				aria-keyshortcuts="Control+K Meta+K"
				className="hidden h-8 w-64 shrink-0 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-left text-[13px] text-[var(--text-muted)] shadow-[var(--shadow-xs)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-secondary)] md:flex xl:w-72"
			>
				<IconSearch size={15} className="shrink-0" />
				<span className="min-w-0 flex-1 truncate">{t("shell.search.trigger")}</span>
				<span className="ui-kbd">⌘K</span>
			</button>
			<button
				type="button"
				onClick={openSearch}
				aria-label={t("shell.search.open")}
				className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] md:hidden"
			>
				<IconSearch size={18} />
			</button>
			<div className="flex shrink-0 items-center gap-0.5">
				<NotificationBell />
				<ThemeToggle compact />
				<span className="max-sm:hidden"><LanguageToggle compact /></span>
			</div>
		</header>
	);
}
