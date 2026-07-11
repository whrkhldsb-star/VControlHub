export interface CatalogItem {
	slug: string;
	name: string;
	category: string;
	icon: string;
	description: string;
	image: string;
	defaultPort: number;
	internalPort: number | null;
	path: string;
	envKeyCount?: number;
	volumesJson?: Array<{ host: string; container: string }> | null;
	extraPorts?: Array<{ host: number; container: number }> | null;
	status: string;
	id: string | null;
	containerId: string | null;
	port: number | null;
	error: string | null;
	source: string;
	stars?: number;
	monthlyPulls?: number;
}

export interface DockerEnvironmentStatus {
	available: boolean;
	running: boolean;
	version: string | null;
	message: string | null;
	installHint: string | null;
}

export interface AppSource {
	id: string;
	name: string;
	displayName: string;
	url: string;
	type: string;
	enabled: boolean;
	lastSyncAt: string | null;
	lastSyncStatus: string | null;
	lastSyncError: string | null;
	syncCount: number;
}

export const CATEGORY_ORDER = ["storage", "media", "devtools", "notes", "network", "blog", "other"];
export const RECOMMENDED_SERVICE_SLUGS = ["alist", "uptime-kuma", "portainer", "vaultwarden", "gitea"];

export function buildCategoryLabels(t: (key: string) => string): Record<string, string> {
	return {
		storage: t("qsPage.category.storage"),
		media: t("qsPage.category.media"),
		devtools: t("qsPage.category.devtools"),
		notes: t("qsPage.category.notes"),
		network: t("qsPage.category.network"),
		blog: t("qsPage.category.blog"),
		other: t("qsPage.category.other"),
	};
}

export const QUICK_SERVICE_PUBLIC_HOST = process.env.NEXT_PUBLIC_QUICK_SERVICE_PUBLIC_HOST ?? "";
export type Tab = "store" | "community" | "installed" | "sources";

export type ItemWithMeta = {
	envKeyCount?: number | null;
	volumesJson?: Array<{ host: string; container: string }> | null;
	internalPort?: number | null;
	defaultPort: number;
};

export function getEnvCount(item: ItemWithMeta): number {
	return item.envKeyCount ?? 0;
}

export function getVolumeMounts(item: ItemWithMeta): Array<{ host: string; container: string }> {
	return item.volumesJson ?? [];
}

export function getPrimaryContainerPort(item: ItemWithMeta): number {
	return item.internalPort ?? item.defaultPort;
}

export function sortByPriority(items: CatalogItem[]): CatalogItem[] {
	return [...items].sort((a, b) => {
		const rank = (item: CatalogItem) => {
			if (item.status === "error") return 0;
			if (item.status === "installing") return 1;
			if (item.status === "stopped") return 2;
			if (item.status === "running") return 3;
			return 4;
		};
		const rankDiff = rank(a) - rank(b);
		if (rankDiff !== 0) return rankDiff;
		const activityA = (a.monthlyPulls ?? 0) + (a.stars ?? 0);
		const activityB = (b.monthlyPulls ?? 0) + (b.stars ?? 0);
		if (activityA !== activityB) return activityB - activityA;
		return a.name.localeCompare(b.name, "zh-Hans-CN");
	});
}

export function buildQuickServiceViewModel(catalog: CatalogItem[], remoteCatalog: CatalogItem[], tab: Tab, search: string) {
	const allItems = [...catalog, ...remoteCatalog];
	const installed = allItems.filter((item) => item.status !== "available");
	const localAvailable = catalog.filter((item) => item.status === "available");
	const remoteAvailable = remoteCatalog.filter((item) => item.status === "available");
	const query = search.trim().toLowerCase();
	const filter = (items: CatalogItem[]) => query
		? items.filter((item) => [item.name, item.description, item.category, item.image].some((value) => value.toLowerCase().includes(query)))
		: items;
	const currentItems = tab === "store" ? filter(localAvailable) : tab === "community" ? filter(remoteAvailable) : filter(installed);
	const grouped: Record<string, CatalogItem[]> = Object.fromEntries(CATEGORY_ORDER.map((category) => [category, []]));
	for (const item of sortByPriority(currentItems)) {
		const category = CATEGORY_ORDER.includes(item.category) ? item.category : "other";
		grouped[category]!.push(item);
	}
	return {
		allItems,
		installed,
		localAvailable,
		remoteAvailable,
		grouped,
		recommendedItems: RECOMMENDED_SERVICE_SLUGS.map((slug) => allItems.find((item) => item.slug === slug)).filter((item): item is CatalogItem => Boolean(item)),
		runningItems: installed.filter((item) => item.status === "running"),
		errorItems: installed.filter((item) => item.status === "error"),
		summary: {
			running: allItems.filter((item) => item.status === "running").length,
			stopped: allItems.filter((item) => item.status === "stopped").length,
			error: allItems.filter((item) => item.status === "error").length,
			available: localAvailable.length + remoteAvailable.length,
		},
	};
}
