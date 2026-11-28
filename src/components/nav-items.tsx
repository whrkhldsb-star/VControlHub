import type { ReactNode } from "react";

import {
	IconArchive,
	IconArrowUpDown,
	IconBadgeCheck,
	IconBell,
	IconBlocks,
	IconBookOpen,
	IconBot,
	IconBraces,
	IconCalendarClock,
	IconContainer,
	IconDashboard,
	IconDownload,
	IconFileCode,
	IconFilm,
	IconFolder,
	IconGauge,
	IconGlobe,
	IconHeartPulse,
	IconImage,
	IconKey as IconKeyGlyph,
	IconKeyRound,
	IconLink,
	IconListChecks,
	IconMegaphone,
	IconMonitorCog,
	IconPlug,
	IconRocket,
	IconScrollText,
	IconServer as IconServerGlyph,
	IconSettings,
	IconSignal,
	IconSiren,
	IconSparkles,
	IconTerminal,
	IconTerminalSquare,
	IconTicket,
	IconBuilding, IconUsers,
	IconWallet,
	IconWorkflow,
} from "./nav-icons";

export interface AppNavItem {
	href: string;
	labelKey: string;
	fallbackLabel: string;
	/** One plain sentence saying what the page is for, beside its siblings (`nav.desc.*`). */
	descKey: string;
	icon: ReactNode;
}

export interface AppNavGroup {
	id: string;
	labelKey: string;
	fallbackLabel: string;
	items: AppNavItem[];
}

/* Glyphs still imported by individual pages. */
export const IconKey = () => <IconKeyGlyph size={18} />;
export const IconCode = () => <IconBraces size={18} />;

/**
 * Grouped primary navigation, ordered by what people come to do: watch their
 * servers, move files, run apps, automate work, ask AI or raise tickets.
 * Platform upkeep (settings, accounts, the Hub host itself, backups of the
 * console) lives in the system group. Every page has its own glyph.
 */
export const mainNavGroups: AppNavGroup[] = [
	{
		id: "overview",
		labelKey: "nav.group.overview",
		fallbackLabel: "Overview",
		items: [
			{ href: "/dashboard", labelKey: "nav.dashboard", fallbackLabel: "Dashboard", descKey: "nav.desc.dashboard", icon: <IconDashboard /> },
			{ href: "/notifications", labelKey: "nav.notifications", fallbackLabel: "Notifications", descKey: "nav.desc.notifications", icon: <IconBell /> },
			{ href: "/announcements", labelKey: "nav.announcements", fallbackLabel: "Announcements", descKey: "nav.desc.announcements", icon: <IconMegaphone /> },
		],
	},
	{
		id: "servers",
		labelKey: "nav.group.servers",
		fallbackLabel: "Servers",
		items: [
			{ href: "/servers", labelKey: "nav.servers", fallbackLabel: "Servers", descKey: "nav.desc.servers", icon: <IconServerGlyph /> },
			{ href: "/vps-status", labelKey: "nav.vps-status", fallbackLabel: "Node status", descKey: "nav.desc.vps-status", icon: <IconSignal /> },
			{ href: "/traffic", labelKey: "nav.traffic", fallbackLabel: "Traffic", descKey: "nav.desc.traffic", icon: <IconArrowUpDown /> },
			{ href: "/alert-rules", labelKey: "nav.alert-rules", fallbackLabel: "Alert rules", descKey: "nav.desc.alert-rules", icon: <IconSiren /> },
			{ href: "/cost-summary", labelKey: "nav.cost-summary", fallbackLabel: "Costs", descKey: "nav.desc.cost-summary", icon: <IconWallet /> },
		],
	},
	{
		id: "files",
		labelKey: "nav.group.files",
		fallbackLabel: "Files & transfer",
		items: [
			{ href: "/files", labelKey: "nav.storage", fallbackLabel: "Files", descKey: "nav.desc.storage", icon: <IconFolder /> },
			{ href: "/downloads", labelKey: "nav.downloads", fallbackLabel: "Downloads", descKey: "nav.desc.downloads", icon: <IconDownload /> },
			{ href: "/shares", labelKey: "nav.share-links", fallbackLabel: "Share links", descKey: "nav.desc.share-links", icon: <IconLink /> },
			{ href: "/media", labelKey: "nav.media", fallbackLabel: "Media", descKey: "nav.desc.media", icon: <IconFilm /> },
			{ href: "/image-bed", labelKey: "nav.image-bed", fallbackLabel: "Image links", descKey: "nav.desc.image-bed", icon: <IconImage /> },
		],
	},
	{
		id: "apps",
		labelKey: "nav.group.apps",
		fallbackLabel: "Apps",
		items: [
			{ href: "/quick-services", labelKey: "nav.quickservice", fallbackLabel: "Quick services", descKey: "nav.desc.quickservice", icon: <IconBlocks /> },
			{ href: "/docker", labelKey: "nav.docker", fallbackLabel: "Docker", descKey: "nav.desc.docker", icon: <IconContainer /> },
			{ href: "/deployments", labelKey: "nav.deployments", fallbackLabel: "App deployment", descKey: "nav.desc.deployments", icon: <IconRocket /> },
		],
	},
	{
		id: "automation",
		labelKey: "nav.group.automation",
		fallbackLabel: "Automation",
		items: [
			{ href: "/commands", labelKey: "nav.commands", fallbackLabel: "Run command", descKey: "nav.desc.commands", icon: <IconTerminal /> },
			{ href: "/operation-tasks", labelKey: "nav.operation-tasks", fallbackLabel: "Tasks", descKey: "nav.desc.operation-tasks", icon: <IconListChecks /> },
			{ href: "/requests", labelKey: "nav.requests", fallbackLabel: "Approvals", descKey: "nav.desc.requests", icon: <IconBadgeCheck /> },
			{ href: "/templates", labelKey: "nav.command-templates", fallbackLabel: "Command templates", descKey: "nav.desc.command-templates", icon: <IconTerminalSquare /> },
			{ href: "/snippets", labelKey: "nav.snippets", fallbackLabel: "Snippets", descKey: "nav.desc.snippets", icon: <IconBraces /> },
			{ href: "/scheduled-tasks", labelKey: "nav.scheduled-tasks", fallbackLabel: "Scheduled tasks", descKey: "nav.desc.scheduled-tasks", icon: <IconCalendarClock /> },
			{ href: "/playbooks", labelKey: "nav.playbooks", fallbackLabel: "Playbook automation", descKey: "nav.desc.playbooks", icon: <IconWorkflow /> },
		],
	},
	{
		id: "assist",
		labelKey: "nav.group.assist",
		fallbackLabel: "AI & tickets",
		items: [
			{ href: "/ai", labelKey: "nav.ai", fallbackLabel: "AI assistant", descKey: "nav.desc.ai", icon: <IconSparkles /> },
			{ href: "/ai-ops", labelKey: "nav.ai-ops", fallbackLabel: "AI ops", descKey: "nav.desc.ai-ops", icon: <IconBot /> },
			{ href: "/knowledge", labelKey: "nav.knowledge", fallbackLabel: "Knowledge", descKey: "nav.desc.knowledge", icon: <IconBookOpen /> },
			{ href: "/tickets", labelKey: "nav.tickets", fallbackLabel: "Tickets & requests", descKey: "nav.desc.tickets", icon: <IconTicket /> },
		],
	},
];

/** Flat list derived from groups — used by mobile nav, search, and tests. */
export const mainNavItems: AppNavItem[] = mainNavGroups.flatMap((group) => group.items);

export const systemNavItems: AppNavItem[] = [
	{ href: "/settings", labelKey: "nav.settings", fallbackLabel: "Settings", descKey: "nav.desc.settings", icon: <IconSettings /> },
	{ href: "/customers", labelKey: "nav.customers", fallbackLabel: "Customers", descKey: "nav.desc.customers", icon: <IconBuilding /> },
	{ href: "/users", labelKey: "nav.users", fallbackLabel: "Users", descKey: "nav.desc.users", icon: <IconUsers /> },
	{ href: "/health", labelKey: "nav.health", fallbackLabel: "Platform health", descKey: "nav.desc.health", icon: <IconHeartPulse /> },
	{ href: "/monitoring", labelKey: "nav.monitoring", fallbackLabel: "Hub host", descKey: "nav.desc.monitoring", icon: <IconGauge /> },
	{ href: "/backups", labelKey: "nav.backup", fallbackLabel: "Backups & migration", descKey: "nav.desc.backup", icon: <IconArchive /> },
	{ href: "/audit", labelKey: "nav.audit", fallbackLabel: "Audit log", descKey: "nav.desc.audit", icon: <IconScrollText /> },
	{ href: "/api-tokens", labelKey: "nav.api-tokens", fallbackLabel: "API tokens", descKey: "nav.desc.api-tokens", icon: <IconKeyRound /> },
	{ href: "/api-docs", labelKey: "nav.api-docs", fallbackLabel: "API docs", descKey: "nav.desc.api-docs", icon: <IconFileCode /> },
	{ href: "/itsm", labelKey: "nav.itsm", fallbackLabel: "ITSM", descKey: "nav.desc.itsm", icon: <IconPlug /> },
	{ href: "/status", labelKey: "nav.status", fallbackLabel: "Status board", descKey: "nav.desc.status", icon: <IconGlobe /> },
	{ href: "/public-status", labelKey: "nav.publicStatusAdmin", fallbackLabel: "Status board settings", descKey: "nav.desc.publicStatusAdmin", icon: <IconMonitorCog /> },
];

export const systemNavGroup: AppNavGroup = {
	id: "system",
	labelKey: "nav.system",
	fallbackLabel: "System",
	items: systemNavItems,
};

// Keep the fixed mobile bar focused on the daily operator loop. Traffic and
// other secondary views remain available from the drawer and global search;
// active operation tasks need a persistent shortcut for queued work.
const mobileNavHrefs = ["/dashboard", "/servers", "/operation-tasks", "/files"] as const;

export const mobileNavItems: AppNavItem[] = mobileNavHrefs.map((href) => {
	const item = mainNavItems.find((navItem) => navItem.href === href);
	if (!item) {
		throw new Error(`Missing mobile navigation item for href: ${href}`);
	}
	return item;
});

export type NavLocation = { group: AppNavGroup; item: AppNavItem };

/**
 * The navigation entry a pathname belongs to: exact match first, then the
 * longest href that is a real path prefix (`/files/search` → `/files`), never
 * a sibling (`/ai-ops` is not under `/ai`).
 */
export function findNavLocation(pathname: string): NavLocation | null {
	const path = pathname === "/" ? "/dashboard" : pathname;
	let best: NavLocation | null = null;
	for (const group of [...mainNavGroups, systemNavGroup]) {
		for (const item of group.items) {
			if (path === item.href || path.startsWith(`${item.href}/`)) {
				if (!best || item.href.length > best.item.href.length) best = { group, item };
			}
		}
	}
	return best;
}
