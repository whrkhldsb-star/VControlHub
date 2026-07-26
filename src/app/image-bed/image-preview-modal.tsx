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
			open
			onClose={onClose}
			label={`Preview ${image.filename}`}
			overlayClassName="fixed inset-0 z-50 bg-[var(--overlay-strong)] flex items-center justify-center p-4"
			panelClassName="relative max-w-4xl max-h-[90vh]"
		>
				<Image
					src={image.publicUrl}
					alt={image.filename}
					width={800}
					height={600}
					loading="lazy"
					unoptimized
					className="max-w-full max-h-[85vh] rounded-lg"
				/>
				<div className="mt-3 flex items-center justify-between gap-2">
					<div>
						<div className="text-sm text-[var(--text-primary)] font-medium">{image.filename}</div>
						<div className="text-xs text-[var(--text-secondary)] mt-1">
							{formatSize(image.sizeBytes)} · {image.mimeType}
						</div>
					</div>
					<div className="flex flex-wrap items-center justify-end gap-2">
						<ActionButton type="submit" variant="outline"
							onClick={() => onCopyLink(image.publicUrl)}
						
							className="!min-h-11 !px-3 !py-1.5 !text-xs"
						>
							{t("imageBed.preview.copyLink")}
						</ActionButton>
						<ActionButton type="submit" variant="success"
							onClick={() => onCopyMarkdown(image)}
						
							className="!min-h-11 !px-3 !py-1.5 !text-xs"
						>
							Markdown
						</ActionButton>
						<ActionButton type="submit" variant="outline"
							onClick={() => onCopyHTML(image)}
						
							className="!min-h-11 !px-3 !py-1.5 !text-xs"
						>
							HTML
						</ActionButton>
						{canDelete && (
							<ActionButton type="submit" variant="danger"
								onClick={() => onRequestDelete(image)}
							
								className="!min-h-11 !px-3 !py-1.5 !text-xs"
							>
								{t("common.delete")}
							</ActionButton>
						)}
					</div>
				</div>
				<button
					onClick={onClose}
					className="absolute -top-3 -right-3 w-8 h-8 bg-[var(--surface-elevated)] text-[var(--text-secondary)] rounded-full flex items-center justify-center hover:bg-[var(--surface-hover)] text-lg"
					aria-label={t("common.close")}
				>
					✕
				</button>
		</ModalShell>
	);
}
