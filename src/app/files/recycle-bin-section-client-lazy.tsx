/**
 * Dynamic wrapper around `RecycleBinSectionClient`.
 *
 * TR-036: The recycle bin panel (deleted entries list, restore
 * buttons, bulk actions) only matters when the user explicitly
 * opens it. Routing it through `next/dynamic` defers that
 * chunk's deleted-entry fetch / restore / purge handlers until
 * React first tries to render it. The stub preserves the panel's
 * outer footprint so the page doesn't visibly shift when the
 * chunk arrives.
 *
 * `ssr: false` is correct: the bin is a pure client-side
 * interaction surface with no value in pre-rendering. Stub
 * preserves vertical space so a slow chunk doesn't make the
 * page look broken.
 *
 * Prop types via `ComponentProps<typeof import(...)>` — TS-only
 * construct that webpack does not follow, so the real component is
 * NOT pulled back into the parent chunk.
 */
"use client";

import dynamic from "next/dynamic";
import type { ComponentProps, ComponentType } from "react";

type RecycleBinSectionClientProps = ComponentProps<
	typeof import("./recycle-bin-section-client").RecycleBinSectionClient
>;

function RecycleBinSectionClientStub() {
	return (
		<div
			aria-hidden
			className="mt-2 h-40 w-full animate-pulse rounded-2xl border border-slate-700/30 bg-slate-900/30"
		/>
	);
}

export const RecycleBinSectionClientLazy: ComponentType<RecycleBinSectionClientProps> =
	dynamic(
		() =>
			import("./recycle-bin-section-client").then(
				(m) => m.RecycleBinSectionClient,
			),
		{ ssr: false, loading: () => <RecycleBinSectionClientStub /> },
	);

export type { RecycleBinSectionClientProps };
