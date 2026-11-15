import { formatBytesPerSecond } from "@/lib/format/bytes";

/* ── Types ────────────────────────────────────────────────── */

export type ServerOption = {
	id: string;
	name: string;
	host: string;
	storagePath: string;
	storageDriver: "LOCAL" | "SFTP" | "WEBDAV";
	directAccessMode: "PROXY" | "DIRECT" | "AUTO";
	directAccessAvailable: boolean;
	accessTransport: "direct" | "relay";
	accessStatusLabel: string;
	accessDescription: string;
};

export type DownloadTask = {
	id: string; url: string; serverId: string; targetPath: string; fileName: string | null;
	status: string; progress: string | null; pid: number | null; errorMessage: string | null;
	relayMode: boolean | null; createdAt: string; updatedAt: string;
	aria2Gid: string | null; category: string | null; maxSpeedKb: number | null;
	totalBytes: string | null; completedBytes: string | null; downloadSpeed: string | null;
	fileSize: string | null; isBatch: boolean; batchUrls: string | null;
	downloadAccess: { mode: string; transport: "direct" | "relay"; href: string; fallbackHref: string | null; label: string; statusLabel: string; description: string } | null;
	server: { id: string; name: string; host: string; storageNode?: { id: string; basePath: string } | null };
	creator: { id: string; username: string; displayName: string | null } | null;
};

export type GlobalStat = { downloadSpeed: string; uploadSpeed: string; numActive: string; numWaiting: string; numStopped: string } | null;

/* ── Status helpers ───────────────────────────────────────── */

export function getStatusLabel(t: (k: string, vars?: Record<string, string | number>) => string): Record<string, string> {
	return {
		PENDING: t("downloadsPage.status.PENDING"),
		RUNNING: t("downloadsPage.status.RUNNING"),
		COMPLETED: t("downloadsPage.status.COMPLETED"),
		FAILED: t("downloadsPage.status.FAILED"),
		CANCELLED: t("downloadsPage.status.CANCELLED"),
	};
}

export function getCategories(t: (k: string, vars?: Record<string, string | number>) => string) {
	return [
		{ value: "", label: t("downloadsPage.form.category.uncategorized") },
		{ value: "video", label: t("downloadsPage.form.category.video") },
		{ value: "music", label: t("downloadsPage.form.category.music") },
		{ value: "software", label: t("downloadsPage.form.category.software") },
		{ value: "document", label: t("downloadsPage.form.category.document") },
		{ value: "image", label: t("downloadsPage.form.category.image") },
	];
}

/** A transfer rate as the rest of the application writes one; "—" while there is none. */
export function formatSpeed(rate: string | number | null): string {
	return rate ? formatBytesPerSecond(rate) : "—";
}

/** What kind of link a download was started from. */
export function urlTypeLabel(url: string, t: (k: string, vars?: Record<string, string | number>) => string) {
	if (url.startsWith("magnet:?")) return t("downloadsPage.linkType.magnet");
	if (url.startsWith("https://")) return "HTTPS";
	if (url.startsWith("http://")) return "HTTP";
	return t("downloadsPage.linkType.unknown");
}

export { getErrorMessage } from "@/lib/http/error-message";
