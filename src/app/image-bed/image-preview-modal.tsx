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
import { Dialog } from "@/components/ui/dialog";
import { Copy, LinkIcon, Trash2 } from "@/components/icons";

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
		<Dialog
			size="full"
			backdrop="strong"
			open
			onClose={onClose}
			title={<span className="break-all">{image.filename}</span>}
			description={`${formatSize(image.sizeBytes)} · ${image.mimeType}`}
			bodyClassName="flex"
			footer={<>
				<ActionButton type="button" variant="secondary" icon={<LinkIcon aria-hidden />} onClick={() => onCopyLink(image.publicUrl)}>
					{t("imageBed.preview.copyLink")}
				</ActionButton>
				<ActionButton type="button" variant="secondary" icon={<Copy aria-hidden />} onClick={() => onCopyMarkdown(image)}>
					Markdown
				</ActionButton>
				<ActionButton type="button" variant="secondary" icon={<Copy aria-hidden />} onClick={() => onCopyHTML(image)}>
					HTML
				</ActionButton>
				{canDelete && (
					<ActionButton type="button" variant="danger" icon={<Trash2 aria-hidden />} onClick={() => onRequestDelete(image)}>
						{t("common.delete")}
					</ActionButton>
				)}
			</>}
		>
			<div data-inset className="flex h-[min(34rem,calc(100dvh-14rem))] min-h-48 min-w-0 flex-1 items-center justify-center overflow-hidden p-2">
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
		</Dialog>
	);
}
