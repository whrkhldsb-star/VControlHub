/**
 * Dynamic wrapper around `AiSettingsPanel`.
 *
 * TR-036: The AI settings panel (provider config, API key form,
 * model selection, save handlers) only renders when the user opens
 * the settings accordion section. Routing it through
 * `next/dynamic` defers that chunk's import graph (config types,
 * save action wiring) until that interaction.
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

type AiSettingsPanelProps = ComponentProps<
	typeof import("./ai-settings-panel").AiSettingsPanel
>;

export const AiSettingsPanelLazy: ComponentType<AiSettingsPanelProps> =
	dynamic(
		() =>
			import("./ai-settings-panel").then((m) => m.AiSettingsPanel),
		{ ssr: false, loading: () => null },
	);

export type { AiSettingsPanelProps };
