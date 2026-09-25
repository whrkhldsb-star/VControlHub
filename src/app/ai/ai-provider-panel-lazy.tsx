/**
 * Dynamic wrapper around `AiProviderPanel`.
 *
 * TR-036: The AI provider panel (test connection, model discovery,
 * provider health checks) only renders when the user opens the
 * provider accordion section. Routing it through `next/dynamic`
 * defers that chunk's import graph (test-connection fetch helpers,
 * model discovery action) until that interaction.
 *
 * `ssr: false` is correct: the panel is a pure client-side
 * interaction surface with no value in pre-rendering. The loading
 * stub renders nothing: the real panel is a modal overlay, and an
 * in-flow placeholder would sit inside the workspace flex row where
 * a full-width block squeezes the chat column to zero width.
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

export const AiProviderPanelLazy: ComponentType<AiProviderPanelProps> =
	dynamic(
		() =>
			import("./ai-provider-panel").then((m) => m.AiProviderPanel),
		{ ssr: false, loading: () => null },
	);

export type { AiProviderPanelProps };
