/**
 * App Source Adapters — fetch & normalize third-party app catalogs
 * into our internal ServiceTemplate format.
 *
 * Each adapter:
 *   1. Fetches raw data from the source URL
 *   2. Normalizes entries to NormalizedApp format
 *   3. De-duplicates against the local SERVICE_CATALOG
 */

import { SERVICE_CATALOG } from "./catalog";
import { createLogger } from "@/lib/logging";
import {
	assertPublicBaseUrlResolvesPublic,
	normalizePublicHttpUrl,
} from "@/lib/storage/direct-access-url";
import {
	readResponseTextLimited,
	ResponseBodyTooLargeError,
} from "@/lib/http/response-body";

const logger = createLogger("app-source:adapters");
const APP_SOURCE_TIMEOUT_MS = 20_000;
const APP_SOURCE_MAX_BYTES = 5 * 1024 * 1024;
const APP_SOURCE_MAX_APPS = 5_000;

function sourceSlug(value: string) {
	const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
	if (!slug) throw new Error("App source name cannot produce a safe slug");
	return slug.slice(0, 64);
}

async function fetchCatalogJson(url: string): Promise<unknown> {
	const res = await fetch(url, {
		method: "GET",
		redirect: "error",
		signal: AbortSignal.timeout(APP_SOURCE_TIMEOUT_MS),
		headers: { Accept: "application/json" },
	});
	if (!res.ok) throw new Error(`Source returned ${res.status}`);
	const declaredSize = Number(res.headers.get("content-length"));
	if (Number.isFinite(declaredSize) && declaredSize > APP_SOURCE_MAX_BYTES) {
		throw new Error("App source response is too large");
	}
	let text: string;
	try {
		text = await readResponseTextLimited(res, APP_SOURCE_MAX_BYTES);
	} catch (error) {
		if (error instanceof ResponseBodyTooLargeError) {
			throw new Error("App source response is too large");
		}
		throw error;
	}
	try {
		return JSON.parse(text);
	} catch {
		throw new Error("App source returned invalid JSON");
	}
}

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
	config?: {
		ports?: Array<{ external: string; internal: string; optional?: boolean }>;
		volumes?: Array<{ path: string; optional?: boolean }>;
	};
}

interface LSIOResponse {
	status: string;
	data: {
		repositories: {
			linuxserver: LSIOImage[];
		};
	};
}

async function fetchLinuxServer(url: string, sourceName: string): Promise<NormalizedApp[]> {
	const data = (await fetchCatalogJson(url)) as LSIOResponse;
	const images = data.data?.repositories?.linuxserver ?? [];
	const prefix = sourceSlug(sourceName);

	// Build set of local catalog slugs to de-duplicate
	const localSlugs = new Set(SERVICE_CATALOG.map((t) => t.slug));
	// Also de-duplicate by image name (e.g. "linuxserver/jellyfin" vs our "jellyfin")
	const localImages = new Set(SERVICE_CATALOG.map((t) => t.image.toLowerCase()));

	return images
		.slice(0, APP_SOURCE_MAX_APPS)
		.filter((img) => img.stable && !img.deprecated)
		// Quick services need a declared TCP web port. Images without one are
		// CLI/base images and cannot provide a useful one-click browser entry.
		.filter((img) => img.config?.ports?.some((port) => /^\d+$/.test(port.external)))
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
			const ports = (img.config?.ports ?? [])
				.map((port) => ({ host: Number(port.external), container: Number(port.internal) }))
				.filter((port) => Number.isInteger(port.host) && port.host > 0 && port.host <= 65535 && Number.isInteger(port.container) && port.container > 0 && port.container <= 65535);
			const primaryPort = ports[0]!;
			const extraPorts = ports.slice(1);
			const volumes = (img.config?.volumes ?? [])
				.filter((volume) => volume.path?.startsWith("/"))
				.map((volume) => ({ host: `/opt/${img.name}${volume.path}`, container: volume.path }));
			return {
				slug: `${prefix}-${sourceSlug(img.name)}`,
				name: img.name
					.replace(/-/g, " ")
					.replace(/\b\w/g, (c) => c.toUpperCase()),
				category,
				icon: CATEGORY_ICONS[category] ?? "📦",
				description: img.description?.substring(0, 200) || "",
				image: `lscr.io/linuxserver/${img.name}:latest`,
				defaultPort: primaryPort.host,
				internalPort: primaryPort.container,
				path: "/",
				envJson: { PUID: "1000", PGID: "1000" },
				volumesJson: volumes,
				extraPorts,
				sourceVersion: img.version,
				sourceName,
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
async function fetchGenericJSON(url: string, sourceName: string): Promise<NormalizedApp[]> {
	const data = await fetchCatalogJson(url) as Record<string, unknown> | unknown[];

	const apps: NormalizedApp[] = [];
	const record = Array.isArray(data) ? null : data;
	const candidateItems = Array.isArray(data) ? data : record?.apps ?? record?.data ?? [];
	const items = Array.isArray(candidateItems) ? candidateItems.slice(0, APP_SOURCE_MAX_APPS) : [];
	const prefix = sourceSlug(sourceName);

	for (const item of items) {
		if (!item || typeof item !== "object") continue;
		const row = item as Record<string, unknown>;
		if (typeof row.name !== "string" || typeof row.image !== "string") continue;
		const slug = sourceSlug(typeof row.slug === "string" ? row.slug : row.name);
		apps.push({
			slug: `${prefix}-${slug}`,
			name: typeof row.displayName === "string" ? row.displayName : row.name,
			category: mapCategory(typeof row.category === "string" ? row.category : "other"),
			icon: typeof row.icon === "string" ? row.icon : CATEGORY_ICONS[mapCategory(typeof row.category === "string" ? row.category : "other")] || "📦",
			description: typeof row.description === "string" ? row.description.slice(0, 500) : "",
			image: row.image,
			defaultPort: typeof row.defaultPort === "number" ? row.defaultPort : typeof row.port === "number" ? row.port : 8080,
			internalPort: typeof row.internalPort === "number" ? row.internalPort : undefined,
			path: typeof row.path === "string" ? row.path : "/",
			envJson: row.envJson && typeof row.envJson === "object" && !Array.isArray(row.envJson) ? row.envJson as Record<string, string> : row.env && typeof row.env === "object" && !Array.isArray(row.env) ? row.env as Record<string, string> : {},
			volumesJson: Array.isArray(row.volumesJson) ? row.volumesJson as NormalizedApp["volumesJson"] : Array.isArray(row.volumes) ? row.volumes as NormalizedApp["volumesJson"] : [],
			command: typeof row.command === "string" ? row.command : undefined,
			sourceName,
			rawJson: JSON.stringify(row).substring(0, 4000),
		});
	}
	return apps;
}

/* ── Adapter registry ─────────────────────────────────────────── */

const ADAPTERS: Record<string, (url: string, sourceName: string) => Promise<NormalizedApp[]>> = {
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
	const adapter = ADAPTERS[sourceType] || ADAPTERS["json"]!;
	try {
		const safeUrl = normalizePublicHttpUrl(url);
		await assertPublicBaseUrlResolvesPublic(new URL(safeUrl).origin);
		const apps = await adapter(safeUrl, sourceName);
		logger.info(`Fetched ${apps.length} apps from ${sourceName} (${sourceType})`);
		return apps;
	} catch (err) {
		logger.error(`Failed to fetch from ${sourceName}: ${err}`);
		throw err;
	}
}
