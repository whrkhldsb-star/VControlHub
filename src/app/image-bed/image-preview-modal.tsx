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
import type { ImageItem } from "./image-bed-types";

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
	if (!image) return null;

	return (
		<div
			className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
			onClick={onClose}
			role="dialog"
			aria-modal="true"
			aria-label={`Preview ${image.filename}`}
		>
			<div
				className="relative max-w-4xl max-h-[90vh]"
				onClick={(e) => e.stopPropagation()}
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
						<button
							onClick={() => onCopyLink(image.publicUrl)}
							data-tone="cyan"
							className="min-h-11 rounded-lg border border-[var(--accent-border)] px-3 py-1.5 text-xs text-[var(--accent)] hover:bg-[var(--accent-bg)]"
						>
							复制外链
						</button>
						<button
							onClick={() => onCopyMarkdown(image)}
							data-tone="emerald"
							className="min-h-11 rounded-lg border border-[var(--success-border)] px-3 py-1.5 text-xs text-[var(--success)] hover:bg-[var(--success-bg)]"
						>
							Markdown
						</button>
						<button
							onClick={() => onCopyHTML(image)}
							data-tone="amber"
							className="min-h-11 rounded-lg border border-[var(--warning-border)] px-3 py-1.5 text-xs text-[var(--warning)] hover:bg-[var(--warning-bg)]"
						>
							HTML
						</button>
						{canDelete && (
							<button
								onClick={() => onRequestDelete(image)}
								data-tone="rose"
								className="min-h-11 rounded-lg border border-[var(--danger-border)] px-3 py-1.5 text-xs text-[var(--danger)] hover:bg-[var(--danger-bg)]"
							>
								删除
							</button>
						)}
					</div>
				</div>
				<button
					onClick={onClose}
					className="absolute -top-3 -right-3 w-8 h-8 bg-[var(--surface-elevated)] text-[var(--text-secondary)] rounded-full flex items-center justify-center hover:bg-[var(--surface-hover)] text-lg"
					aria-label="Close preview"
				>
					✕
				</button>
			</div>
		</div>
	);
}
