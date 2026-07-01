/**
 * Dynamic wrapper around `ServerOverviewDetails`.
 *
 * TR-036: The expanded "查看详情" panel (connection details,
 * operations, diagnostic items, latest commands) only renders
 * when the user clicks the toggle. Routing it through
 * `next/dynamic` defers that chunk's `ServerCardActions` import
 * graph (and its server-action / form wiring) until that
 * interaction. The stub preserves the panel's outer footprint
 * so the parent card doesn't visibly shift when the chunk
 * arrives.
 *
 * `ssr: false` is correct: the panel is a pure client-side
 * interaction surface with no value in pre-rendering. Stub
 * preserves vertical space so a slow chunk doesn't make the
 * collapsed card look broken.
 *
 * Prop types via `ComponentProps<typeof import(...)>` — TS-only
 * construct that webpack does not follow, so the real component is
 * NOT pulled back into the parent chunk.
 */
"use client";

import dynamic from "next/dynamic";
import type { ComponentProps, ComponentType } from "react";

type ServerOverviewDetailsProps = ComponentProps<
	typeof import("./server-overview-details").ServerOverviewDetails
>;

function ServerOverviewDetailsStub() {
	return (
		<div
			aria-hidden
			className="mt-4 space-y-3 border-t border-[var(--border)] pt-4"
		>
			<div className="h-24 w-full animate-pulse rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)]" />
			<div className="h-24 w-full animate-pulse rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)]" />
			<div className="h-32 w-full animate-pulse rounded-lg border border-[var(--color-action-border)]/10 bg-[var(--color-action-bg)]/[0.035]" />
		</div>
	);
}

export const ServerOverviewDetailsLazy: ComponentType<ServerOverviewDetailsProps> =
	dynamic(
		() =>
			import("./server-overview-details").then(
				(m) => m.ServerOverviewDetails,
			),
		{ ssr: false, loading: () => <ServerOverviewDetailsStub /> },
	);

export type { ServerOverviewDetailsProps };
