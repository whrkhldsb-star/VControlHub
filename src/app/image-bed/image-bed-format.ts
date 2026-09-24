import { formatShortDate, formatShortTime } from "@/lib/datetime/format";
import type { ImageItem } from "./image-bed-types";
import { formatImageSize } from "./image-bed-sections";

export { formatImageSize };

export function formatImageDate(iso: string, locale: string): string {
	const typedLocale = locale as "zh" | "en";
	return `${formatShortDate(iso, typedLocale)} ${formatShortTime(iso, typedLocale)}`;
}

export function formatPublishSource(
	img: ImageItem,
	t: (key: string, vars?: Record<string, string | number>) => string,
): string {
	if (!img.storageNodeId || !img.relativePath) {
		return t("imageBedPage.source.directUpload");
	}
	const nodeName = img.storageNode?.server?.name
		? `${img.storageNode.name} · ${img.storageNode.server.name}`
		: img.storageNode?.name ?? t("imageBedPage.source.storageNode");
	return `${nodeName} / ${img.relativePath}`;
}
