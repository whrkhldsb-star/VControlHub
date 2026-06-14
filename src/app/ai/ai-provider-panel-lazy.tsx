/**
 * Dynamic wrapper around `AiProviderPanel`.
 *
 * TR-036: The AI provider panel (test connection, model discovery,
 * provider health checks) only renders when the user opens the
 * provider accordion section. Routing it through `next/dynamic`
 * defers that chunk's import graph (test-connection fetch helpers,
 * model discovery action) until that interaction. The stub matches
 * the panel's outer card so the page doesn't visibly shift when
 * the chunk arrives.
 *
 * `ssr: false` is correct: the panel is a pure client-side
 * interaction surface with no value in pre-rendering. Stub
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

type AiProviderPanelProps = ComponentProps<
	typeof import("./ai-provider-panel").AiProviderPanel
>;

function AiProviderPanelStub() {
	return (
		<div
			aria-hidden
			className="mt-2 h-40 w-full animate-pulse rounded-2xl border border-slate-700/30 bg-slate-900/30"
		/>
	);
}

export const AiProviderPanelLazy: ComponentType<AiProviderPanelProps> =
	dynamic(
		() =>
			import("./ai-provider-panel").then((m) => m.AiProviderPanel),
		{ ssr: false, loading: () => <AiProviderPanelStub /> },
	);

export type { AiProviderPanelProps };
