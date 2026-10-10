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
	IconPlug,
	IconRocket,
	IconScrollText,
	IconServer as IconServerGlyph,
	IconSettings,
	IconSignal,
	IconSiren,
	IconSparkles,
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
export const IconServer = () => <IconServerGlyph size={18} />;

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
			{ href: "/dashboard", labelKey: "nav.dashboard", fallbackLabel: "Dashboard", icon: <IconDashboard /> },
			{ href: "/notifications", labelKey: "nav.notifications", fallbackLabel: "Notifications", icon: <IconBell /> },
		],
	},
	{
		id: "servers",
		labelKey: "nav.group.servers",
		fallbackLabel: "Servers",
		items: [
			{ href: "/servers", labelKey: "nav.servers", fallbackLabel: "Servers", icon: <IconServerGlyph /> },
			{ href: "/vps-status", labelKey: "nav.vps-status", fallbackLabel: "Node Status", icon: <IconSignal /> },
			{ href: "/traffic", labelKey: "nav.traffic", fallbackLabel: "Traffic", icon: <IconArrowUpDown /> },
			{ href: "/alert-rules", labelKey: "nav.alert-rules", fallbackLabel: "Alert Rules", icon: <IconSiren /> },
			{ href: "/cost-summary", labelKey: "nav.cost-summary", fallbackLabel: "Costs", icon: <IconWallet /> },
		],
	},
	{
		id: "files",
		labelKey: "nav.group.files",
		fallbackLabel: "Files & transfer",
		items: [
			{ href: "/files", labelKey: "nav.storage", fallbackLabel: "Files", icon: <IconFolder /> },
			{ href: "/downloads", labelKey: "nav.downloads", fallbackLabel: "Downloads", icon: <IconDownload /> },
			{ href: "/shares", labelKey: "nav.share-links", fallbackLabel: "Share Links", icon: <IconLink /> },
			{ href: "/media", labelKey: "nav.media", fallbackLabel: "Media", icon: <IconFilm /> },
			{ href: "/image-bed", labelKey: "nav.image-bed", fallbackLabel: "Image Links", icon: <IconImage /> },
		],
	},
	{
		id: "apps",
		labelKey: "nav.group.apps",
		fallbackLabel: "Apps",
		items: [
			{ href: "/quick-services", labelKey: "nav.quickservice", fallbackLabel: "Quick Apps", icon: <IconBlocks /> },
			{ href: "/docker", labelKey: "nav.docker", fallbackLabel: "Docker", icon: <IconContainer /> },
			{ href: "/deployments", labelKey: "nav.deployments", fallbackLabel: "Deployments", icon: <IconRocket /> },
		],
	},
	{
		id: "automation",
		labelKey: "nav.group.automation",
		fallbackLabel: "Automation",
		items: [
			{ href: "/operation-tasks", labelKey: "nav.operation-tasks", fallbackLabel: "Tasks", icon: <IconListChecks /> },
			{ href: "/requests", labelKey: "nav.requests", fallbackLabel: "Approvals", icon: <IconBadgeCheck /> },
			{ href: "/templates", labelKey: "nav.command-templates", fallbackLabel: "Command Templates", icon: <IconTerminalSquare /> },
			{ href: "/snippets", labelKey: "nav.snippets", fallbackLabel: "Snippets", icon: <IconBraces /> },
			{ href: "/scheduled-tasks", labelKey: "nav.scheduled-tasks", fallbackLabel: "Scheduled Tasks", icon: <IconCalendarClock /> },
			{ href: "/playbooks", labelKey: "nav.playbooks", fallbackLabel: "Playbook Automation", icon: <IconWorkflow /> },
		],
	},
	{
		id: "assist",
		labelKey: "nav.group.assist",
		fallbackLabel: "AI & tickets",
		items: [
			{ href: "/ai", labelKey: "nav.ai", fallbackLabel: "AI Assistant", icon: <IconSparkles /> },
			{ href: "/ai-ops", labelKey: "nav.ai-ops", fallbackLabel: "AI Ops", icon: <IconBot /> },
			{ href: "/knowledge", labelKey: "nav.knowledge", fallbackLabel: "Knowledge", icon: <IconBookOpen /> },
			{ href: "/tickets", labelKey: "nav.tickets", fallbackLabel: "Tickets", icon: <IconTicket /> },
			{ href: "/announcements", labelKey: "nav.announcements", fallbackLabel: "Announcements", icon: <IconMegaphone /> },
		],
	},
];

/** Flat list derived from groups — used by mobile nav, search, and tests. */
export const mainNavItems: AppNavItem[] = mainNavGroups.flatMap((group) => group.items);

export const systemNavItems: AppNavItem[] = [
	{ href: "/settings", labelKey: "nav.settings", fallbackLabel: "Settings", icon: <IconSettings /> },
	{ href: "/customers", labelKey: "nav.customers", fallbackLabel: "Customers", icon: <IconBuilding /> },
	{ href: "/users", labelKey: "nav.users", fallbackLabel: "Users", icon: <IconUsers /> },
	{ href: "/health", labelKey: "nav.health", fallbackLabel: "Platform Health", icon: <IconHeartPulse /> },
	{ href: "/monitoring", labelKey: "nav.monitoring", fallbackLabel: "Hub Host", icon: <IconGauge /> },
	{ href: "/backups", labelKey: "nav.backup", fallbackLabel: "Backups", icon: <IconArchive /> },
	{ href: "/audit", labelKey: "nav.audit", fallbackLabel: "Audit Log", icon: <IconScrollText /> },
	{ href: "/api-tokens", labelKey: "nav.api-tokens", fallbackLabel: "API Token", icon: <IconKeyRound /> },
	{ href: "/api-docs", labelKey: "nav.api-docs", fallbackLabel: "API Docs", icon: <IconFileCode /> },
	{ href: "/itsm", labelKey: "nav.itsm", fallbackLabel: "ITSM", icon: <IconPlug /> },
	{ href: "/status", labelKey: "nav.status", fallbackLabel: "Public Status", icon: <IconGlobe /> },
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
