/**
 * Dynamic wrapper around `ImagePreviewModal`.
 *
 * TR-036: The full-size preview only renders when the user clicks an
 * image card. Routing it through `next/dynamic` defers the modal
 * chunk (full Image component, copy / delete action handlers) until
 * that interaction. The stub matches the modal's max-w-4xl / 85vh
 * footprint so the user doesn't see a layout shift on the first
 * open while the chunk loads.
 *
 * `ssr: false` is correct: the modal is purely an interaction
 * affordance, and pre-rendering it would have no value. Stub
 * preserves vertical space so a slow chunk doesn't make the page
 * look broken.
 *
 * Prop types via `ComponentProps<typeof import(...)>` — TS-only
 * construct that webpack does not follow, so the real component is
 * NOT pulled back into the parent chunk.
 */
"use client";

import dynamic from "next/dynamic";
import type { ComponentProps, ComponentType } from "react";

type ImagePreviewModalProps = ComponentProps<
	typeof import("./image-preview-modal").ImagePreviewModal
>;

function ImagePreviewModalStub() {
	return (
		<div
			aria-hidden
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
		>
			<div className="h-[60vh] w-full max-w-4xl animate-pulse rounded-lg bg-slate-800/60" />
		</div>
	);
}

export const ImagePreviewModalLazy: ComponentType<ImagePreviewModalProps> =
	dynamic(
		() =>
			import("./image-preview-modal").then((m) => m.ImagePreviewModal),
		{ ssr: false, loading: () => <ImagePreviewModalStub /> },
	);

export type { ImagePreviewModalProps };
