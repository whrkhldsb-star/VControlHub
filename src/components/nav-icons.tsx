/**
 * Navigation and shell icons — one consistent outline set (24px grid,
 * 1.75 stroke, round joins), so every page has its own recognisable glyph
 * in the sidebar, the command palette, breadcrumbs and the mobile tab bar.
 */
import type { ReactNode, SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & { size?: number };

function glyph(children: ReactNode, displayName: string) {
	function Icon({ size = 18, strokeWidth = 1.75, className, ...rest }: IconProps) {
		return (
			<svg
				width={size}
				height={size}
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth={strokeWidth}
				strokeLinecap="round"
				strokeLinejoin="round"
				aria-hidden="true"
				focusable="false"
				className={className}
				{...rest}
			>
				{children}
			</svg>
		);
	}
	Icon.displayName = displayName;
	return Icon;
}

/* ── Navigation ───────────────────────────────────────────────────────── */

export const IconDashboard = glyph(<>
	<rect width="7" height="9" x="3" y="3" rx="1.5" />
	<rect width="7" height="5" x="14" y="3" rx="1.5" />
	<rect width="7" height="9" x="14" y="12" rx="1.5" />
	<rect width="7" height="5" x="3" y="16" rx="1.5" />
</>, "IconDashboard");

export const IconServer = glyph(<>
	<rect width="20" height="8" x="2" y="2" rx="2" />
	<rect width="20" height="8" x="2" y="14" rx="2" />
	<path d="M6 6h.01" />
	<path d="M6 18h.01" />
</>, "IconServer");

export const IconHeartPulse = glyph(<>
	<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
	<path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27" />
</>, "IconHeartPulse");

export const IconSignal = glyph(<>
	<path d="M2 20h.01" />
	<path d="M7 20v-4" />
	<path d="M12 20v-8" />
	<path d="M17 20V8" />
	<path d="M22 4v16" />
</>, "IconSignal");

export const IconGauge = glyph(<>
	<path d="m12 14 4-4" />
	<path d="M3.34 19a10 10 0 1 1 17.32 0" />
</>, "IconGauge");

export const IconArrowUpDown = glyph(<>
	<path d="m21 16-4 4-4-4" />
	<path d="M17 20V4" />
	<path d="m3 8 4-4 4 4" />
	<path d="M7 4v16" />
</>, "IconArrowUpDown");

export const IconWallet = glyph(<>
	<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
	<path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
</>, "IconWallet");

export const IconFolder = glyph(<>
	<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
</>, "IconFolder");

export const IconDownload = glyph(<>
	<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
	<path d="m7 10 5 5 5-5" />
	<path d="M12 15V3" />
</>, "IconDownload");

export const IconLink = glyph(<>
	<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
	<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
</>, "IconLink");

export const IconFilm = glyph(<>
	<rect width="18" height="18" x="3" y="3" rx="2" />
	<path d="M7 3v18" />
	<path d="M3 7.5h4" />
	<path d="M3 12h18" />
	<path d="M3 16.5h4" />
	<path d="M17 3v18" />
	<path d="M17 7.5h4" />
	<path d="M17 16.5h4" />
</>, "IconFilm");

export const IconImage = glyph(<>
	<rect width="18" height="18" x="3" y="3" rx="2" />
	<circle cx="9" cy="9" r="2" />
	<path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
</>, "IconImage");

export const IconListChecks = glyph(<>
	<path d="m3 17 2 2 4-4" />
	<path d="m3 7 2 2 4-4" />
	<path d="M13 6h8" />
	<path d="M13 12h8" />
	<path d="M13 18h8" />
</>, "IconListChecks");

export const IconArchive = glyph(<>
	<rect width="20" height="5" x="2" y="3" rx="1" />
	<path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
	<path d="M10 12h4" />
</>, "IconArchive");

export const IconTerminalSquare = glyph(<>
	<path d="m7 11 2-2-2-2" />
	<path d="M11 13h4" />
	<rect width="18" height="18" x="3" y="3" rx="2" />
</>, "IconTerminalSquare");

export const IconRocket = glyph(<>
	<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
	<path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
	<path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
	<path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
</>, "IconRocket");

export const IconBlocks = glyph(<>
	<rect width="7" height="7" x="14" y="3" rx="1" />
	<path d="M10 21V8a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H3" />
</>, "IconBlocks");

export const IconContainer = glyph(<>
	<path d="M22 7.7c0-.6-.4-1.2-.8-1.5l-6.3-3.9a1.72 1.72 0 0 0-1.7 0l-10.3 6c-.5.2-.9.8-.9 1.4v6.6c0 .5.4 1.2.8 1.5l6.3 3.9a1.72 1.72 0 0 0 1.7 0l10.3-6c.5-.3.9-1 .9-1.5Z" />
	<path d="M10 21.9V14L2.1 9.1" />
	<path d="m10 14 11.9-6.9" />
	<path d="M14 19.8v-8.1" />
	<path d="M18 17.5V9.4" />
</>, "IconContainer");

export const IconBraces = glyph(<>
	<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1" />
	<path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1" />
</>, "IconBraces");

export const IconCalendarClock = glyph(<>
	<path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5" />
	<path d="M16 2v4" />
	<path d="M8 2v4" />
	<path d="M3 10h5" />
	<path d="M17.5 17.5 16 16.3V14" />
	<circle cx="16" cy="16" r="6" />
</>, "IconCalendarClock");

export const IconWorkflow = glyph(<>
	<rect width="8" height="8" x="3" y="3" rx="2" />
	<path d="M7 11v4a2 2 0 0 0 2 2h4" />
	<rect width="8" height="8" x="13" y="13" rx="2" />
</>, "IconWorkflow");

export const IconSiren = glyph(<>
	<path d="M7 18v-6a5 5 0 1 1 10 0v6" />
	<path d="M5 21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z" />
	<path d="M21 12h1" />
	<path d="M18.5 4.5 18 5" />
	<path d="M2 12h1" />
	<path d="M12 2v1" />
	<path d="m4.929 4.929.707.707" />
	<path d="M12 12v6" />
</>, "IconSiren");

export const IconSparkles = glyph(<>
	<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
	<path d="M20 3v4" />
	<path d="M22 5h-4" />
	<path d="M4 17v2" />
	<path d="M5 18H3" />
</>, "IconSparkles");

export const IconBookOpen = glyph(<>
	<path d="M12 7v14" />
	<path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
</>, "IconBookOpen");

export const IconBot = glyph(<>
	<path d="M12 8V4H8" />
	<rect width="16" height="12" x="4" y="8" rx="2" />
	<path d="M2 14h2" />
	<path d="M20 14h2" />
	<path d="M15 13v2" />
	<path d="M9 13v2" />
</>, "IconBot");

export const IconMegaphone = glyph(<>
	<path d="m3 11 18-5v12L3 14v-3z" />
	<path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
</>, "IconMegaphone");

export const IconTicket = glyph(<>
	<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
	<path d="M13 5v2" />
	<path d="M13 17v2" />
	<path d="M13 11v2" />
</>, "IconTicket");

export const IconPlug = glyph(<>
	<path d="M12 22v-5" />
	<path d="M9 8V2" />
	<path d="M15 8V2" />
	<path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
</>, "IconPlug");

export const IconBadgeCheck = glyph(<>
	<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
	<path d="m9 12 2 2 4-4" />
</>, "IconBadgeCheck");

export const IconBell = glyph(<>
	<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
	<path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
</>, "IconBell");

export const IconSettings = glyph(<>
	<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
	<circle cx="12" cy="12" r="3" />
</>, "IconSettings");

export const IconUsers = glyph(<>
	<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
	<circle cx="9" cy="7" r="4" />
	<path d="M22 21v-2a4 4 0 0 0-3-3.87" />
	<path d="M16 3.13a4 4 0 0 1 0 7.75" />
</>, "IconUsers");

export const IconKeyRound = glyph(<>
	<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" />
	<circle cx="16.5" cy="7.5" r=".5" fill="currentColor" />
</>, "IconKeyRound");

export const IconFileCode = glyph(<>
	<path d="M10 12.5 8 15l2 2.5" />
	<path d="m14 12.5 2 2.5-2 2.5" />
	<path d="M14 2v4a2 2 0 0 0 2 2h4" />
	<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
</>, "IconFileCode");

export const IconGlobe = glyph(<>
	<circle cx="12" cy="12" r="10" />
	<path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
	<path d="M2 12h20" />
</>, "IconGlobe");

export const IconScrollText = glyph(<>
	<path d="M15 12h-5" />
	<path d="M15 8h-5" />
	<path d="M19 17V5a2 2 0 0 0-2-2H4" />
	<path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3" />
</>, "IconScrollText");

/* ── Shell ────────────────────────────────────────────────────────────── */

export const IconSearch = glyph(<>
	<circle cx="11" cy="11" r="8" />
	<path d="m21 21-4.3-4.3" />
</>, "IconSearch");

export const IconPanelLeft = glyph(<>
	<rect width="18" height="18" x="3" y="3" rx="2" />
	<path d="M9 3v18" />
</>, "IconPanelLeft");

export const IconMenu = glyph(<>
	<path d="M4 6h16" />
	<path d="M4 12h16" />
	<path d="M4 18h16" />
</>, "IconMenu");

export const IconChevronRight = glyph(<path d="m9 18 6-6-6-6" />, "IconChevronRight");
export const IconChevronDown = glyph(<path d="m6 9 6 6 6-6" />, "IconChevronDown");
export const IconChevronsUpDown = glyph(<>
	<path d="m7 15 5 5 5-5" />
	<path d="m7 9 5-5 5 5" />
</>, "IconChevronsUpDown");

export const IconSun = glyph(<>
	<circle cx="12" cy="12" r="4" />
	<path d="M12 2v2" />
	<path d="M12 20v2" />
	<path d="m4.93 4.93 1.41 1.41" />
	<path d="m17.66 17.66 1.41 1.41" />
	<path d="M2 12h2" />
	<path d="M20 12h2" />
	<path d="m6.34 17.66-1.41 1.41" />
	<path d="m19.07 4.93-1.41 1.41" />
</>, "IconSun");

export const IconMoon = glyph(<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />, "IconMoon");

export const IconLanguages = glyph(<>
	<path d="m5 8 6 6" />
	<path d="m4 14 6-6 2-3" />
	<path d="M2 5h12" />
	<path d="M7 2h1" />
	<path d="m22 22-5-10-5 10" />
	<path d="M14 18h6" />
</>, "IconLanguages");

export const IconLogOut = glyph(<>
	<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
	<path d="m16 17 5-5-5-5" />
	<path d="M21 12H9" />
</>, "IconLogOut");

export const IconShield = glyph(<>
	<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
	<path d="m9 12 2 2 4-4" />
</>, "IconShield");

export const IconKey = glyph(<>
	<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4" />
	<path d="m21 2-9.6 9.6" />
	<circle cx="7.5" cy="15.5" r="5.5" />
</>, "IconKey");

export const IconSliders = glyph(<>
	<path d="M21 4h-7" />
	<path d="M10 4H3" />
	<path d="M21 12h-9" />
	<path d="M8 12H3" />
	<path d="M21 20h-5" />
	<path d="M12 20H3" />
	<path d="M14 2v4" />
	<path d="M8 10v4" />
	<path d="M16 18v4" />
</>, "IconSliders");

export const IconStar = glyph(<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />, "IconStar");

export const IconExternalLink = glyph(<>
	<path d="M15 3h6v6" />
	<path d="M10 14 21 3" />
	<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
</>, "IconExternalLink");

export const IconHistory = glyph(<>
	<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
	<path d="M3 3v5h5" />
	<path d="M12 7v5l4 2" />
</>, "IconHistory");

export const IconZap = glyph(<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />, "IconZap");

export const IconKeyboard = glyph(<>
	<path d="M10 8h.01" />
	<path d="M12 12h.01" />
	<path d="M14 8h.01" />
	<path d="M16 12h.01" />
	<path d="M18 8h.01" />
	<path d="M6 8h.01" />
	<path d="M7 16h10" />
	<path d="M8 12h.01" />
	<rect width="20" height="16" x="2" y="4" rx="2" />
</>, "IconKeyboard");

export const IconMore = glyph(<>
	<circle cx="12" cy="12" r="1" />
	<circle cx="19" cy="12" r="1" />
	<circle cx="5" cy="12" r="1" />
</>, "IconMore");

export const IconLayoutGrid = glyph(<>
	<rect width="7" height="7" x="3" y="3" rx="1" />
	<rect width="7" height="7" x="14" y="3" rx="1" />
	<rect width="7" height="7" x="14" y="14" rx="1" />
	<rect width="7" height="7" x="3" y="14" rx="1" />
</>, "IconLayoutGrid");

/** Brand mark: a hub with three connected nodes. Inherits currentColor. */
export function BrandMark({ size = 18, className }: { size?: number; className?: string }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" className={className}>
			<path d="M12 12V5.5M12 12l5.6 3.3M12 12l-5.6 3.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
			<circle cx="12" cy="12" r="3" fill="currentColor" />
			<circle cx="12" cy="4.5" r="2" fill="currentColor" />
			<circle cx="18.5" cy="16" r="2" fill="currentColor" />
			<circle cx="5.5" cy="16" r="2" fill="currentColor" />
		</svg>
	);
}

/** The logo mark on its brand tile — one definition for the sidebar, login and other brand spots. */
export function BrandTile({ size = 28, className }: { size?: number; className?: string }) {
	return (
		<span
			aria-hidden="true"
			style={{ width: size, height: size, borderRadius: Math.round(size * 0.29) }}
			className={`flex shrink-0 items-center justify-center bg-[image:var(--brand-gradient)] text-white shadow-[var(--highlight-inset),var(--shadow-sm)] ${className ?? ""}`}
		>
			<BrandMark size={Math.round(size * 0.58)} />
		</span>
	);
}
