/**
 * Status board site settings: constants, validation and defaults. Client-safe
 * (no database import); reading and saving live in `./site`.
 */
import { z } from "zod";

export const PUBLIC_METRIC_CATEGORIES = [
	"cpu",
	"memory",
	"disk",
	"network",
	"traffic",
	"uptime",
	"load",
	"latency",
	"availability",
	"system",
	"connections",
	"billing",
] as const;
export type PublicMetricCategory = (typeof PUBLIC_METRIC_CATEGORIES)[number];

/** Billing (price and expiry) is the administrator's to publish, never a default. */
export const DEFAULT_PUBLIC_METRICS: PublicMetricCategory[] = PUBLIC_METRIC_CATEGORIES.filter((category) => category !== "billing");

export const PUBLIC_REFRESH_SECONDS = [10, 15, 30, 60] as const;
export const PUBLIC_ACCENTS = ["default", "indigo", "purple", "emerald", "amber", "rose"] as const;
export type PublicAccent = (typeof PUBLIC_ACCENTS)[number];
export const PUBLIC_VIEWS = ["cards", "table"] as const;
export type PublicView = (typeof PUBLIC_VIEWS)[number];

export const TITLE_MAX = 80;
export const DESCRIPTION_MAX = 500;
export const ANNOUNCEMENT_MAX = 2000;

export type PublicSiteConfig = {
	enabled: boolean;
	title: string | null;
	description: string | null;
	announcement: string | null;
	defaultView: PublicView;
	refreshSeconds: (typeof PUBLIC_REFRESH_SECONDS)[number];
	accent: PublicAccent;
	metrics: PublicMetricCategory[];
	showPlatformStatus: boolean;
	updatedAt: string | null;
};

export const DEFAULT_PUBLIC_SITE: PublicSiteConfig = {
	enabled: false,
	title: null,
	description: null,
	announcement: null,
	defaultView: "cards",
	refreshSeconds: 15,
	accent: "default",
	metrics: [...DEFAULT_PUBLIC_METRICS],
	showPlatformStatus: true,
	updatedAt: null,
};

/**
 * Plain text only: drop control characters except newline/tab, normalise line
 * endings, trim, and turn an empty result into null. React escapes the text
 * when rendering; nothing here is ever treated as HTML or Markdown.
 */
export function cleanPlainText(value: string | null | undefined, max: number): string | null {
	if (value === null || value === undefined) return null;
	const cleaned = value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").trim();
	if (!cleaned) return null;
	return cleaned.slice(0, max);
}

const refreshSchema = z.union([z.literal(10), z.literal(15), z.literal(30), z.literal(60)]);

export const publicSiteUpdateSchema = z.object({
	enabled: z.boolean(),
	title: z.string().max(TITLE_MAX * 2).nullable(),
	description: z.string().max(DESCRIPTION_MAX * 2).nullable(),
	announcement: z.string().max(ANNOUNCEMENT_MAX * 2).nullable(),
	defaultView: z.enum(PUBLIC_VIEWS),
	refreshSeconds: refreshSchema,
	accent: z.enum(PUBLIC_ACCENTS),
	metrics: z.array(z.enum(PUBLIC_METRIC_CATEGORIES)).max(PUBLIC_METRIC_CATEGORIES.length),
	showPlatformStatus: z.boolean(),
}).strict();
export type PublicSiteUpdate = z.infer<typeof publicSiteUpdateSchema>;

type SiteRow = {
	enabled: boolean;
	title: string | null;
	description: string | null;
	announcement: string | null;
	defaultView: string;
	refreshSeconds: number;
	accent: string;
	metrics: string[];
	showPlatformStatus: boolean;
	updatedAt: Date;
};

export function siteConfigFromRow(row: SiteRow | null): PublicSiteConfig {
	if (!row) return { ...DEFAULT_PUBLIC_SITE, metrics: [...DEFAULT_PUBLIC_SITE.metrics] };
	const view = (PUBLIC_VIEWS as readonly string[]).includes(row.defaultView) ? (row.defaultView as PublicView) : "cards";
	const refresh = (PUBLIC_REFRESH_SECONDS as readonly number[]).includes(row.refreshSeconds)
		? (row.refreshSeconds as PublicSiteConfig["refreshSeconds"])
		: 15;
	const accent = (PUBLIC_ACCENTS as readonly string[]).includes(row.accent) ? (row.accent as PublicAccent) : "default";
	const metrics = PUBLIC_METRIC_CATEGORIES.filter((category) => row.metrics.includes(category));
	return {
		enabled: row.enabled,
		title: row.title,
		description: row.description,
		announcement: row.announcement,
		defaultView: view,
		refreshSeconds: refresh,
		accent,
		metrics,
		showPlatformStatus: row.showPlatformStatus,
		updatedAt: row.updatedAt.toISOString(),
	};
}

