/**
 * Dynamic wrapper around `FileUploadDropzone`.
 *
 * TR-036: The upload section (file input, drag-and-drop, multipart
 * POST, progress UI) is only relevant when the user has write
 * permission on the current node. Routing it through
 * `next/dynamic` defers that chunk's `@/components/storage/*`
 * import graph until React first tries to render it. The stub
 * matches the upload section's outer card so the page doesn't
 * visibly shift when the chunk arrives.
 *
 * `ssr: false` is correct: the dropzone is a pure client-side
 * interaction surface (drag/drop + file input) with no value
 * in pre-rendering. Stub preserves vertical space so a slow
 * chunk doesn't make the page look broken.
 *
 * Prop types via `ComponentProps<typeof import(...)>` — TS-only
 * construct that webpack does not follow, so the real component is
 * NOT pulled back into the parent chunk.
 */
"use client";

import dynamic from "next/dynamic";
import type { ComponentProps, ComponentType } from "react";

type FileUploadDropzoneProps = ComponentProps<
	typeof import("@/components/storage/file-upload-dropzone").FileUploadDropzone
>;

function FileUploadDropzoneStub() {
	return (
		<div
			aria-hidden
			className="mt-2 h-48 w-full animate-pulse rounded-2xl border border-cyan-400/15 bg-slate-900/30"
		/>
	);
}

export const FileUploadDropzoneLazy: ComponentType<FileUploadDropzoneProps> =
	dynamic(
		() =>
			import("@/components/storage/file-upload-dropzone").then(
				(m) => m.FileUploadDropzone,
			),
		{ ssr: false, loading: () => <FileUploadDropzoneStub /> },
	);

export type { FileUploadDropzoneProps };
