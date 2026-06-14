/**
 * Dynamic wrapper around `AiSettingsPanel`.
 *
 * TR-036: The AI settings panel (provider config, API key form,
 * model selection, save handlers) only renders when the user opens
 * the settings accordion section. Routing it through
 * `next/dynamic` defers that chunk's import graph (config types,
 * save action wiring) until that interaction. The stub matches
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

type AiSettingsPanelProps = ComponentProps<
	typeof import("./ai-settings-panel").AiSettingsPanel
>;

function AiSettingsPanelStub() {
	return (
		<div
			aria-hidden
			className="mt-2 h-40 w-full animate-pulse rounded-2xl border border-slate-700/30 bg-slate-900/30"
		/>
	);
}

export const AiSettingsPanelLazy: ComponentType<AiSettingsPanelProps> =
	dynamic(
		() =>
			import("./ai-settings-panel").then((m) => m.AiSettingsPanel),
		{ ssr: false, loading: () => <AiSettingsPanelStub /> },
	);

export type { AiSettingsPanelProps };
