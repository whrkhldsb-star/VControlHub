/**
 * Shared types for the image-bed page. Extracted from
 * `image-bed-page-client.tsx` so the page and the new `useImageBedList`
 * hook can share them without circular imports.
 */

export type ImageItem = {
	id: string;
	filename: string;
	mimeType: string;
	sizeBytes: number;
	album: string | null;
	isPublic: boolean;
	createdAt: string;
	publicUrl: string;
	storageNodeId?: string | null;
	relativePath?: string | null;
	storageNode?: { id: string; name: string; driver: string; server?: { name: string } | null } | null;
	user?: { username: string; displayName: string | null };
};

export type ImageStats = {
	totalCount: number;
	totalSizeBytes: number;
	totalSizeMB: number;
	albums: Array<{ album: string; count: number; sizeBytes: number }>;
	uploadTrend: Array<{ date: string; count: number }>;
};

export type UploadQueueItem = {
	name: string;
	status: "pending" | "uploading" | "success" | "error" | "skipped";
	message: string;
};

export type UploadProgress = {
	total: number;
	current: number;
	success: number;
	failure: number;
	queue: UploadQueueItem[];
} | null;

export type PendingDelete =
	| { type: "single"; id: string; filename: string }
	| { type: "batch"; count: number };

export function getErrorMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}
