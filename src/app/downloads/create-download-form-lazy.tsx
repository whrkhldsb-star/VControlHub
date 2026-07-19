/**
 * Dynamic wrapper around `CreateDownloadForm`.
 *
 * TR-036: The "新建下载" form (URL input, batch textarea, server
 * select, target path, file name, category, speed limit, magnet
 * hint, submit button) only renders when the user opens the create
 * flow. Routing it through `next/dynamic` defers the form chunk
 * until that interaction. The stub matches the form's ~12-row
 * footprint so the page doesn't visibly shift when the chunk
 * arrives.
 *
 * `ssr: false` is correct: the form is purely an interaction
 * affordance triggered by a click. Stub preserves vertical space
 * so a slow chunk doesn't make the page look broken.
 *
 * Prop types via `ComponentProps<typeof import(...)>` — TS-only
 * construct that webpack does not follow, so the real component is
 * NOT pulled back into the parent chunk.
 */
"use client";

import dynamic from "next/dynamic";
import type { ComponentProps, ComponentType } from "react";

type CreateDownloadFormProps = ComponentProps<
	typeof import("./create-download-form").CreateDownloadForm
>;

function CreateDownloadFormStub() {
	return (
		<div
			aria-hidden
			data-card
			className="mb-6 p-5 space-y-4"
		>
			<div className="h-6 w-40 animate-pulse rounded-lg bg-[var(--surface-subtle)]" />
			<div className="h-10 w-full animate-pulse rounded-lg bg-[var(--surface-subtle)]" />
			<div className="grid gap-4 sm:grid-cols-2">
				<div className="h-12 animate-pulse rounded-lg bg-[var(--surface-subtle)]" />
				<div className="h-12 animate-pulse rounded-lg bg-[var(--surface-subtle)]" />
			</div>
			<div className="grid gap-4 sm:grid-cols-3">
				<div className="h-12 animate-pulse rounded-lg bg-[var(--surface-subtle)]" />
				<div className="h-12 animate-pulse rounded-lg bg-[var(--surface-subtle)]" />
				<div className="h-12 animate-pulse rounded-lg bg-[var(--surface-subtle)]" />
			</div>
			<div className="h-10 w-32 animate-pulse rounded-2xl bg-[var(--surface-subtle)]" />
		</div>
	);
}

export const CreateDownloadFormLazy: ComponentType<CreateDownloadFormProps> =
	dynamic(
		() =>
			import("./create-download-form").then((m) => m.CreateDownloadForm),
		{ ssr: false, loading: () => <CreateDownloadFormStub /> },
	);

export type { CreateDownloadFormProps };
