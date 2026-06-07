/**
 * App Source Adapters — fetch & normalize third-party app catalogs
 * into our internal ServiceTemplate format.
 *
 * Each adapter:
 *   1. Fetches raw data from the source URL
 *   2. Normalizes entries to NormalizedApp format
 *   3. De-duplicates against the local SERVICE_CATALOG
 */

import type { ServiceTemplate } from "./types";
import { SERVICE_CATALOG } from "./catalog";
import { createLogger } from "@/lib/logging";
import { normalizePublicHttpUrl } from "@/lib/storage/direct-access-url";

const logger = createLogger("app-source:adapters");

/* ── Shared types ──────────────────────────────────────────────── */

export interface NormalizedApp {
	slug: string;
	name: string;
	category: string;
	icon: string;
	description: string;
	image: string;
	defaultPort: number;
	internalPort?: number;
	path: string;
	envJson: Record<string, string>;
	volumesJson: Array<{ host: string; container: string }>;
	command?: string;
	extraPorts?: Array<{ host: number; container: number }>;
	/** Source-specific version tag for change detection */
	sourceVersion?: string;
	/** Original raw data for debugging */
	rawJson?: string;
	/** Source name prefix (e.g. "linuxserver") */
	sourceName: string;
	/** Stars/popularity metric */
	stars?: number;
	/** Monthly pulls metric */
	monthlyPulls?: number;
}

/* ── Category mapping ──────────────────────────────────────────── */

const CATEGORY_MAP: Record<string, string> = {
	// LSIO categories → our categories
	"Content Management": "blog",
	"Media Servers": "media",
	"Media Servers,Music": "media",
	Music: "media",
	Photos: "media",
	Books: "media",
	"Media Management": "media",
	"Productivity": "notes",
	"Other": "other",
	"Network,DNS": "network",
	Network: "network",
	DNS: "network",
	Monitoring: "network",
	"Web Tools": "devtools",
	"Web Tools,Automation": "devtools",
	Automation: "devtools",
	Programming: "devtools",
	"Home Automation": "devtools",
	"3D Printing": "devtools",
	Finance: "other",
	Games: "other",
	Chat: "other",
	Science: "other",
	FTP: "storage",
	"File Browser": "storage",
	"Cloud": "storage",
	"Backup": "storage",
	"Download": "storage",
	"Password": "devtools",
	"Authentication": "devtools",
	Family: "other",
	Documents: "notes",
	"Audio Processing": "media",
	"Video": "media",
	"3D Modeling": "devtools",
	"Web Browser": "other",
};

function mapCategory(raw: string): string {
	// Try exact match first
	if (CATEGORY_MAP[raw]) return CATEGORY_MAP[raw];
	// Try substring match (categories can be comma-separated)
	for (const [key, val] of Object.entries(CATEGORY_MAP)) {
		if (raw.includes(key)) return val;
	}
	return "other";
}

/* ── LSIO Category → emoji icon ─────────────────────────────── */

const CATEGORY_ICONS: Record<string, string> = {
	storage: "☁️",
	media: "🎬",
	devtools: "🔧",
	notes: "📝",
	network: "🌐",
	blog: "✍️",
	other: "📦",
};

/* ── LinuxServer.io Adapter ──────────────────────────────────── */

interface LSIOImage {
	name: string;
	description: string;
	category: string;
	project_logo: string;
	project_url: string;
	github_url: string;
	version: string;
	stable: boolean;
	deprecated: boolean;
	stars: number;
	monthly_pulls: number;
	tags: Array<{ tag: string; desc: string }>;
}

interface LSIOResponse {
	status: string;
	data: {
		repositories: {
			linuxserver: LSIOImage[];
		};
	};
}

async function fetchLinuxServer(url: string): Promise<NormalizedApp[]> {
	const res = await fetch(url, { next: { revalidate: 3600 } });
	if (!res.ok) throw new Error(`LSIO API returned ${res.status}`);

	const data: LSIOResponse = await res.json();
	const images = data.data?.repositories?.linuxserver ?? [];

	// Build set of local catalog slugs to de-duplicate
	const localSlugs = new Set(SERVICE_CATALOG.map((t) => t.slug));
	// Also de-duplicate by image name (e.g. "linuxserver/jellyfin" vs our "jellyfin")
	const localImages = new Set(SERVICE_CATALOG.map((t) => t.image.toLowerCase()));

	return images
		.filter((img) => img.stable && !img.deprecated)
		.filter((img) => {
			// Skip if we already have this locally
			if (localSlugs.has(img.name)) return false;
			const imageName = `lscr.io/linuxserver/${img.name}:latest`.toLowerCase();
			if (localImages.has(imageName)) return false;
			// Also check if image name matches a local catalog entry
			for (const local of SERVICE_CATALOG) {
				if (local.image.toLowerCase().includes(`/${img.name}:`)) return false;
			}
			return true;
		})
		.map((img): NormalizedApp => {
			const category = mapCategory(img.category);
			return {
				slug: `linuxserver-${img.name}`,
				name: img.name
					.replace(/-/g, " ")
					.replace(/\b\w/g, (c) => c.toUpperCase()),
				category,
				icon: CATEGORY_ICONS[category] ?? "📦",
				description: img.description?.substring(0, 200) || "",
				image: `lscr.io/linuxserver/${img.name}:latest`,
				defaultPort: 8080, // LSIO images use variable ports, we'll auto-assign
				path: "/",
				envJson: { PUID: "0", PGID: "0" },
				volumesJson: [
					{ host: `/opt/${img.name}/config`, container: "/config" },
				],
				sourceVersion: img.version,
				sourceName: "linuxserver",
				stars: img.stars,
				monthlyPulls: img.monthly_pulls,
				rawJson: JSON.stringify({
					name: img.name,
					github_url: img.github_url,
					project_url: img.project_url,
					project_logo: img.project_logo,
					category: img.category,
					tags: img.tags,
				}),
			};
		})
		.filter((app) => !/altus|chromium|firefox|chrome|desktop/i.test(app.slug));
}

/* ── Custom JSON Adapter (generic) ───────────────────────────── */

/**
 * Generic JSON adapter for sources that serve a JSON array of app definitions.
 * Expected format: array of objects with at least { name, image } fields.
 */
async function fetchGenericJSON(url: string): Promise<NormalizedApp[]> {
	const res = await fetch(url, { next: { revalidate: 3600 } });
	if (!res.ok) throw new Error(`Source returned ${res.status}`);
	const data = await res.json();

	const apps: NormalizedApp[] = [];
	const items = Array.isArray(data) ? data : data.apps ?? data.data ?? [];

	for (const item of items) {
		if (!item.name || !item.image) continue;
		const slug = item.slug || item.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
		apps.push({
			slug: `custom-${slug}`,
			name: item.displayName || item.name,
			category: mapCategory(item.category || "other"),
			icon: item.icon || CATEGORY_ICONS[mapCategory(item.category || "other")] || "📦",
			description: item.description || "",
			image: item.image,
			defaultPort: item.defaultPort || item.port || 8080,
			internalPort: item.internalPort,
			path: item.path || "/",
			envJson: item.envJson || item.env || {},
			volumesJson: item.volumesJson || item.volumes || [],
			command: item.command,
			sourceName: "custom",
			rawJson: JSON.stringify(item).substring(0, 4000),
		});
	}
	return apps;
}

/* ── Adapter registry ─────────────────────────────────────────── */

const ADAPTERS: Record<string, (url: string) => Promise<NormalizedApp[]>> = {
	linuxserver: fetchLinuxServer,
	json: fetchGenericJSON,
	github: fetchGenericJSON, // For now, GitHub raw JSON falls through to generic
};

/**
 * Fetch apps from a source using the appropriate adapter.
 */
export async function fetchSourceApps(
	sourceName: string,
	sourceType: string,
	url: string,
): Promise<NormalizedApp[]> {
	const adapter = ADAPTERS[sourceType] || ADAPTERS["json"];
	try {
		const safeUrl = normalizePublicHttpUrl(url);
		const apps = await adapter(safeUrl);
		logger.info(`Fetched ${apps.length} apps from ${sourceName} (${sourceType})`);
		return apps;
	} catch (err) {
		logger.error(`Failed to fetch from ${sourceName}: ${err}`);
		throw err;
	}
}

/**
 * Get the local catalog slugs for de-duplication.
 */
export function getLocalCatalogSlugs(): Set<string> {
	return new Set(SERVICE_CATALOG.map((t) => t.slug));
}

/**
 * Merge local + remote apps, de-duplicating by slug prefix and image name.
 * Local catalog always takes priority.
 */
export function mergeCatalogs(
	localApps: ServiceTemplate[],
	remoteApps: NormalizedApp[],
): Array<ServiceTemplate | NormalizedApp> {
	const localSlugs = new Set(localApps.map((a) => a.slug));
	const localImages = new Set(localApps.map((a) => a.image.toLowerCase()));

	const filtered = remoteApps.filter((app) => {
		if (localSlugs.has(app.slug)) return false;
		if (localImages.has(app.image.toLowerCase())) return false;
		return true;
	});

	return [...localApps, ...filtered];
}
