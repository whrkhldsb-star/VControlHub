/**
 * Dynamic wrapper around `FindBar`.
 *
 * TR-036: The search input + jump-to-line control only renders
 * when the user views a text file preview. Routing it through
 * `next/dynamic` defers the chunk (search highlight helper, jump
 * callback) until that interaction. The stub matches the bar's
 * two-input horizontal layout so the header doesn't shift when
 * the chunk arrives.
 *
 * `ssr: false` is correct: the bar is purely an interaction
 * affordance triggered by viewing a text file, and pre-rendering
 * it would have no value. Stub preserves vertical space so a
 * slow chunk doesn't make the header look broken.
 *
 * Prop types via `ComponentProps<typeof import(...)>` — TS-only
 * construct that webpack does not follow, so the real component is
 * NOT pulled back into the parent chunk.
 */
"use client";

import dynamic from "next/dynamic";
import type { ComponentProps, ComponentType } from "react";

type FindBarProps = ComponentProps<typeof import("./find-bar").FindBar>;

function FindBarStub() {
	return (
		<div
			aria-hidden
			className="flex items-end gap-2"
		>
			<div className="flex flex-col gap-1">
				<div className="h-3 w-12 animate-pulse rounded bg-[var(--surface)]/[0.10]" />
				<div className="h-7 w-36 animate-pulse rounded-lg bg-[var(--surface)]/[0.04]" />
			</div>
			<div className="flex flex-col gap-1">
				<div className="h-3 w-12 animate-pulse rounded bg-[var(--surface)]/[0.10]" />
				<div className="h-7 w-24 animate-pulse rounded-lg bg-[var(--surface)]/[0.04]" />
			</div>
		</div>
	);
}

export const FindBarLazy: ComponentType<FindBarProps> = dynamic(
	() => import("./find-bar").then((m) => m.FindBar),
	{ ssr: false, loading: () => <FindBarStub /> },
);

export type { FindBarProps };
