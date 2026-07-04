/**
 * Dynamic wrappers around the per-row file action buttons.
 *
 * TR-036: Each of these 4 components ({Delete,Rename,Move}InlineForm,
 * ShareFileButton) imports its own action handlers, dialog logic and
 * CSRF/csrfFetch helpers. When `file-list-client.tsx` imports them
 * statically, all of that ships in the initial /files page bundle even
 * though most users never click any single file's edit affordances.
 *
 * Routing them through `next/dynamic` defers each component (and its
 * import graph) until React first tries to render it. The placeholder
 * stubs match the visual size of the real button so there is no layout
 * shift while the chunk loads — the user just sees a disabled-looking
 * affordance for ~50ms on a slow connection.
 *
 * `ssr: false` is correct: every one of these components calls hooks
 * (`useActionState`, `useState`, `useRouter`) and triggers server
 * actions on click. There is no value in pre-rendering them on the
 * server side.
 *
 * IMPORTANT: We must *not* `import` the real components statically —
 * doing so pulls them back into the parent chunk, defeating the whole
 * point. Prop types are reached via `typeof import(...)` (a TypeScript
 * type-only construct that webpack does not follow).
 */
"use client";

import dynamic from "next/dynamic";
import type { ComponentProps, ComponentType } from "react";

/* ── Stubs ──────────────────────────────────────────────────────── */

function IconButtonStub({ label }: { label: string }) {
	return (
		<button
			type="button"
			disabled
			aria-label={label}
			className="inline-flex h-8 w-8 items-center justify-center rounded text-[var(--text-muted)]"
		>
			<span className="h-3 w-3 rounded-full bg-current opacity-30" />
		</button>
	);
}

function InlineFormStub() {
	return (
		<span className="inline-flex h-8 items-center px-2 text-xs text-[var(--text-muted)]">
			…
		</span>
	);
}

/* ── Dynamic wrappers ───────────────────────────────────────────── */

type DeleteConfirmButtonProps = ComponentProps<
	typeof import("./delete-confirm-button").DeleteConfirmButton
>;
export const DeleteConfirmButton: ComponentType<DeleteConfirmButtonProps> =
	dynamic(
		() =>
			import("./delete-confirm-button").then((m) => m.DeleteConfirmButton),
		{ ssr: false, loading: () => <IconButtonStub label="删除" /> },
	);

type RenameInlineFormProps = ComponentProps<
	typeof import("./rename-inline-form").RenameInlineForm
>;
export const RenameInlineForm: ComponentType<RenameInlineFormProps> = dynamic(
	() => import("./rename-inline-form").then((m) => m.RenameInlineForm),
	{ ssr: false, loading: () => <InlineFormStub /> },
);

type MoveInlineFormProps = ComponentProps<
	typeof import("./move-inline-form").MoveInlineForm
>;
export const MoveInlineForm: ComponentType<MoveInlineFormProps> = dynamic(
	() => import("./move-inline-form").then((m) => m.MoveInlineForm),
	{ ssr: false, loading: () => <InlineFormStub /> },
);

type ShareFileButtonProps = ComponentProps<
	typeof import("./share-file-button").ShareFileButton
>;
export const ShareFileButton: ComponentType<ShareFileButtonProps> = dynamic(
	() => import("./share-file-button").then((m) => m.ShareFileButton),
	{ ssr: false, loading: () => <IconButtonStub label="分享" /> },
);
