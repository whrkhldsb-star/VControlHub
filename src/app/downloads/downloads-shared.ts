/* ── Types ────────────────────────────────────────────────── */

export type ServerOption = {
	id: string;
	name: string;
	host: string;
	storagePath: string;
	storageDriver: "LOCAL" | "SFTP";
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

export function getStatusLabel(t: (k: string) => string): Record<string, string> {
	return {
		PENDING: t("downloadsPage.status.PENDING"),
		RUNNING: t("downloadsPage.status.RUNNING"),
		COMPLETED: t("downloadsPage.status.COMPLETED"),
		FAILED: t("downloadsPage.status.FAILED"),
		CANCELLED: t("downloadsPage.status.CANCELLED"),
	};
}

export function getCategories(t: (k: string) => string) {
	return [
		{ value: "", label: t("downloadsPage.form.category.uncategorized"), icon: "📦" },
		{ value: "video", label: t("downloadsPage.form.category.video"), icon: "🎬" },
		{ value: "music", label: t("downloadsPage.form.category.music"), icon: "🎵" },
		{ value: "software", label: t("downloadsPage.form.category.software"), icon: "💿" },
		{ value: "document", label: t("downloadsPage.form.category.document"), icon: "📄" },
		{ value: "image", label: t("downloadsPage.form.category.image"), icon: "🖼️" },
	];
}

export function formatSpeed(b: string | number | null): string {
	if (!b) return "—";
	const n = typeof b === "string" ? parseInt(b, 10) : b;
	if (isNaN(n) || n === 0) return "0 B/s";
	const units = ["B/s", "KB/s", "MB/s", "GB/s"];
	const i = Math.floor(Math.log(n) / Math.log(1024));
	return `${(n / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

export function getErrorMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}
