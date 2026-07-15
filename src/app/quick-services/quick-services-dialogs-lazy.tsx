/**
 * Dynamic wrappers around the Quick Services confirmation dialogs.
 *
 * TR-036: the install / uninstall / source-delete confirmations render
 * as a fixed-overlay modal only when the user clicks the corresponding
 * action. They are NOT part of the initial /quick-services render path,
 * so deferring their chunks (and the small amount of dialog code +
 * icon classes) is a free bundle win.
 *
 * `ssr: false` is correct: the dialogs read no SSR-visible state and
 * can never be invoked before the user is on the page.
 *
 * Prop types are read via `ComponentProps<typeof import(...)>` — a
 * TypeScript-only construct that webpack does not follow, so the
 * real components are NOT pulled back into the parent chunk.
 */
"use client";

import dynamic from "next/dynamic";
import type { ComponentProps, ComponentType } from "react";

/* ── Stubs ──────────────────────────────────────────────────────── */

function DialogStub({ label }: { label: string }) {
	return (
		<div
			aria-hidden
			data-testid={`quick-service-${label}-loading`}
			className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] backdrop-blur-sm"
		>
			<div className="h-48 w-full max-w-md animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--surface-root)]" />
		</div>
	);
}

/* ── Source-delete confirmation ──────────────────────────────────── */

type PendingSourceDeleteDialogProps = ComponentProps<
	typeof import("./pending-source-delete-dialog").PendingSourceDeleteDialog
>;
export const PendingSourceDeleteDialogLazy: ComponentType<PendingSourceDeleteDialogProps> =
	dynamic(
		() =>
			import("./pending-source-delete-dialog").then(
				(m) => m.PendingSourceDeleteDialog,
			),
		{
			ssr: false,
			loading: () => <DialogStub label="source-delete" />,
		},
	);
export type { PendingSourceDeleteDialogProps };

/* ── Uninstall confirmation ─────────────────────────────────────── */

type PendingUninstallDialogProps = ComponentProps<
	typeof import("./pending-uninstall-dialog").PendingUninstallDialog
>;
export const PendingUninstallDialogLazy: ComponentType<PendingUninstallDialogProps> =
	dynamic(
		() =>
			import("./pending-uninstall-dialog").then(
				(m) => m.PendingUninstallDialog,
			),
		{
			ssr: false,
			loading: () => <DialogStub label="uninstall" />,
		},
	);
export type { PendingUninstallDialogProps };

/* ── Install / update config preview confirmation (TR-036 T37) ─── */

type ConfigPreviewDialogProps = ComponentProps<
	typeof import("./config-preview-dialog").ConfigPreviewDialog
>;
export const ConfigPreviewDialogLazy: ComponentType<ConfigPreviewDialogProps> =
	dynamic(
		() =>
			import("./config-preview-dialog").then(
				(m) => m.ConfigPreviewDialog,
			),
		{
			ssr: false,
			loading: () => <DialogStub label="config-preview" />,
		},
	);
export type { ConfigPreviewDialogProps };
