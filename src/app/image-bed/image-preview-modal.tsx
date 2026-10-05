/**
 * Real `ImagePreviewModal` component.
 *
 * TR-036: Split out from `image-bed-page-client.tsx` so the modal
 * (full-size Image + copy / delete actions) only ships in the
 * client chunk when the user actually opens a preview. The parent
 * page ships the grid + upload / batch flows; the modal chunk
 * is fetched on first click.
 *
 * The component receives its data + callbacks as plain props so the
 * parent doesn't need to expose `useState` setters. Internally we
 * short-circuit to `null` if `image` is null, which lets the parent
 * drop the `{previewImage && (...)}` wrapper and call the lazy
 * component unconditionally.
 */
"use client";

import Image from "next/image";
import { useI18n } from "@/lib/i18n/use-locale";
import type { ImageItem } from "./image-bed-types";
import { ActionButton } from "@/components/action-button";
import { ModalShell } from "@/components/modal-shell";
import { IconButton } from "@/components/ui-primitives";
import { Copy, LinkIcon, Trash2, X } from "@/components/icons";

export interface ImagePreviewModalProps {
	image: ImageItem | null;
	canDelete: boolean;
	onClose: () => void;
	onCopyLink: (url: string) => void;
	onCopyMarkdown: (img: ImageItem) => void;
	onCopyHTML: (img: ImageItem) => void;
	onRequestDelete: (img: ImageItem) => void;
	formatSize: (bytes: number) => string;
}

export function ImagePreviewModal({
	image,
	canDelete,
	onClose,
	onCopyLink,
	onCopyMarkdown,
	onCopyHTML,
	onRequestDelete,
	formatSize,
}: ImagePreviewModalProps) {
	const { t } = useI18n();

	if (!image) return null;

	return (
		<ModalShell
			size="full" backdrop="strong" className="flex h-[min(44rem,calc(100dvh-2rem))] min-w-0 flex-col gap-4"
			open
			onClose={onClose}
			labelledBy="image-preview-title"
		>
			<div className="flex min-w-0 shrink-0 items-start gap-3">
				<div className="min-w-0 flex-1">
					<h2 id="image-preview-title" className="break-all text-sm font-semibold text-[var(--text-primary)]">{image.filename}</h2>
					<div className="mt-1 text-xs text-[var(--text-secondary)]">
						{formatSize(image.sizeBytes)} · {image.mimeType}
					</div>
				</div>
				<IconButton label={t("common.close")} onClick={onClose}><X size={18} aria-hidden /></IconButton>
			</div>
			<div className="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden bg-[var(--input-bg)] p-2">
				<Image
					src={image.publicUrl}
					alt={image.filename}
					width={image.width || 800}
					height={image.height || 600}
					loading="lazy"
					unoptimized
					className="block h-auto max-h-full w-auto max-w-full object-contain"
				/>
			</div>
			<div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] pt-3">
				<ActionButton size="sm" type="button" variant="secondary"
					onClick={() => onCopyLink(image.publicUrl)}>
					<LinkIcon size={16} aria-hidden />{t("imageBed.preview.copyLink")}
				</ActionButton>
				<ActionButton size="sm" type="button" variant="secondary"
					onClick={() => onCopyMarkdown(image)}>
					<Copy size={16} aria-hidden />Markdown
				</ActionButton>
				<ActionButton size="sm" type="button" variant="secondary"
					onClick={() => onCopyHTML(image)}>
					<Copy size={16} aria-hidden />HTML
				</ActionButton>
				{canDelete && (
					<ActionButton size="sm" type="button" variant="danger"
						onClick={() => onRequestDelete(image)}>
						<Trash2 size={16} aria-hidden />{t("common.delete")}
					</ActionButton>
				)}
			</div>
		</ModalShell>
	);
}
