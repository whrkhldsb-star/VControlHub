import { toDateLocale } from "@/lib/i18n/locale-format";
import type { ImageItem } from "./image-bed-types";
import { formatImageSize } from "./image-bed-sections";

export { formatImageSize };

export function formatImageDate(iso: string, locale: string): string {
	return new Date(iso).toLocaleString(toDateLocale(locale as "zh" | "en"), {
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	});
}

export function formatPublishSource(
	img: ImageItem,
	t: (key: string) => string,
): string {
	if (!img.storageNodeId || !img.relativePath) {
		return t("imageBedPage.source.directUpload");
	}
	const nodeName = img.storageNode?.server?.name
		? `${img.storageNode.name} · ${img.storageNode.server.name}`
		: img.storageNode?.name ?? t("imageBedPage.source.storageNode");
	return `${nodeName} / ${img.relativePath}`;
}
