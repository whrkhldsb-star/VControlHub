"use client";

/**
 * Image viewer for the drive: the folder's images one at a time, with
 * previous / next (buttons and ← →), download and details. Opening an image
 * no longer leaves the folder; the preview page stays one click away.
 */
import { useEffect, useState } from "react";

import { ButtonLink } from "@/components/action-button";
import { ChevronRight, Download, Info, Maximize2 } from "@/components/icons";
import { Dialog } from "@/components/ui/dialog";
import { IconButton, Spinner } from "@/components/ui-primitives";
import { useI18n } from "@/lib/i18n/use-locale";
import { buildForcedDownloadHref, buildProxyDownloadHref, getPreviewHref, toStorageEntry, type FileProp } from "./file-entry-utils";
import { triggerDownload } from "./file-entry-menu";

export function ImageLightbox({ images, index, onIndexChange, onClose, onDetails }: {
	images: FileProp[];
	index: number;
	onIndexChange: (index: number) => void;
	onClose: () => void;
	onDetails: (id: string) => void;
}) {
	const { t } = useI18n();
	const image = images[index]!;
	const entry = toStorageEntry(image);
	const src = buildProxyDownloadHref(entry);
	const [loaded, setLoaded] = useState<string | null>(null);
	const hasPrevious = index > 0;
	const hasNext = index < images.length - 1;

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "ArrowLeft" && hasPrevious) {
				event.preventDefault();
				onIndexChange(index - 1);
			} else if (event.key === "ArrowRight" && hasNext) {
				event.preventDefault();
				onIndexChange(index + 1);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [index, hasPrevious, hasNext, onIndexChange]);

	// Warm the neighbours so stepping through a folder feels instant.
	useEffect(() => {
		for (const neighbour of [images[index - 1], images[index + 1]]) {
			if (!neighbour) continue;
			const preload = new Image();
			preload.decoding = "async";
			preload.src = buildProxyDownloadHref(toStorageEntry(neighbour));
		}
	}, [images, index]);

	return (
		<Dialog
			open
			size="full"
			backdrop="strong"
			onClose={onClose}
			title={<span className="block truncate">{image.name}</span>}
			description={`${index + 1} / ${images.length} · ${image.sizeLabel}`}
			closeLabel={t("common.close")}
			bodyClassName="!p-0"
			headerActions={<>
				<IconButton label={t("fileListClient.downloadTitle")} onClick={() => triggerDownload(buildForcedDownloadHref(entry))}>
					<Download size={18} aria-hidden />
				</IconButton>
				<IconButton label={t("fileListClient.detailTitle")} onClick={() => onDetails(image.id)}>
					<Info size={18} aria-hidden />
				</IconButton>
				<ButtonLink href={getPreviewHref(entry)} variant="ghost" size="sm" square aria-label={t("filesPage.drive.openPreviewPage")} title={t("filesPage.drive.openPreviewPage")}>
					<Maximize2 aria-hidden />
				</ButtonLink>
			</>}
		>
			<div className="relative grid min-h-[50dvh] place-items-center bg-[color-mix(in_srgb,var(--surface-subtle)_60%,transparent)]">
				{loaded !== src ? <Spinner size="md" label={t("common.loading")} className="absolute" /> : null}
				{/* eslint-disable-next-line @next/next/no-img-element */}
				<img
					key={src}
					src={src}
					alt={image.name}
					onLoad={() => setLoaded(src)}
					onError={() => setLoaded(src)}
					className="max-h-[calc(100dvh-10rem)] max-w-full object-contain"
				/>
				{hasPrevious ? (
					<IconButton label={t("filesPage.drive.previousImage")} onClick={() => onIndexChange(index - 1)}
						className="absolute left-2 top-1/2 h-11 w-11 -translate-y-1/2 bg-[color-mix(in_srgb,var(--surface)_85%,transparent)] shadow-[var(--shadow-md)]">
						<ChevronRight size={22} className="rotate-180" aria-hidden />
					</IconButton>
				) : null}
				{hasNext ? (
					<IconButton label={t("filesPage.drive.nextImage")} onClick={() => onIndexChange(index + 1)}
						className="absolute right-2 top-1/2 h-11 w-11 -translate-y-1/2 bg-[color-mix(in_srgb,var(--surface)_85%,transparent)] shadow-[var(--shadow-md)]">
						<ChevronRight size={22} aria-hidden />
					</IconButton>
				) : null}
			</div>
		</Dialog>
	);
}
