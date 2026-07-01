/**
 * Dynamic wrapper around `AiInputArea`.
 *
 * TR-036: The AI chat composer (file upload button + textarea + send/stop
 * buttons) is one of the largest sub-trees in `ai-client.tsx`. Routing it
 * through `next/dynamic` defers that chunk's import graph (formatting
 * helpers, model capability types, file attachment interfaces) until the
 * first chat composer renders. The stub preserves the composer's bottom
 * border so the page doesn't visibly shift when the chunk arrives.
 *
 * `ssr: false` is correct: the composer is a pure client-side interaction
 * surface; pre-rendering it would pull its full import graph into the
 * initial server payload.
 *
 * Prop types via `ComponentProps<typeof import(...)>` — TS-only construct
 * that webpack does not follow, so the real component is NOT pulled back
 * into the parent chunk.
 */
"use client";

import dynamic from "next/dynamic";
import type { ComponentProps, ComponentType } from "react";

type AiInputAreaProps = ComponentProps<typeof import("./ai-input-area").AiInputArea>;

function AiInputAreaStub() {
	return (
		<div
			aria-hidden
			className="px-4 py-3 border-t border-[var(--border)] bg-[var(--surface-subtle)]"
		>
			<div className="h-10 w-full animate-pulse rounded-xl bg-[var(--surface)]/[0.04]" />
		</div>
	);
}

export const AiInputAreaLazy: ComponentType<AiInputAreaProps> = dynamic(
	() => import("./ai-input-area").then((m) => m.AiInputArea),
	{ ssr: false, loading: () => <AiInputAreaStub /> },
);

export type { AiInputAreaProps };
