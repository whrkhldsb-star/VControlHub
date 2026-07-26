"use client";

import type { Ref, RefObject } from "react";
import { ActionButton } from "@/components/action-button";
import { type Container, getContainerName } from "./docker-helpers";

export function DockerRemovalDialog({
	pendingRemoval,
	t,
	actionLoading,
	removalDialogRef,
	removeCancelButtonRef,
	closeRemovalDialog,
	confirmRemoval,
}: {
	pendingRemoval: Container | null;
	t: (key: string, vars?: Record<string, string | number>) => string;
	actionLoading: string | null;
	removalDialogRef: RefObject<HTMLDivElement | null>;
	removeCancelButtonRef: Ref<HTMLButtonElement>;
	closeRemovalDialog: () => void;
	confirmRemoval: () => Promise<void>;
}) {
	if (!pendingRemoval) return null;
	return (
		<div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-[var(--overlay)] p-0 backdrop-blur-sm sm:items-center sm:p-4" role="presentation" onClick={closeRemovalDialog}>
			<div
				ref={removalDialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="docker-remove-confirm-title"
				className="w-full max-w-md mx-0 rounded-t-2xl border border-[var(--danger-border)] bg-[var(--modal-bg)] p-5 shadow-2xl sm:mx-4 sm:rounded-2xl"
				onClick={(event) => event.stopPropagation()}
			>
				<h3 id="docker-remove-confirm-title" className="text-base font-semibold text-[var(--text-primary)]">{t("dockerPage.removeDialog.title")}</h3>
				<p className="mt-3 text-sm text-[var(--text-secondary)]">
					{t("dockerPage.removeDialog.confirm", { name: getContainerName(t, pendingRemoval) })}
				</p>
				<div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
					<ActionButton variant="secondary"
						ref={removeCancelButtonRef}
						onClick={closeRemovalDialog} className="min-h-11 !px-3 !py-1.5 !text-xs">
						{t("dockerPage.removeDialog.cancel")}
					</ActionButton>
					<ActionButton variant="danger-solid"
						onClick={() => void confirmRemoval()}
						disabled={actionLoading === pendingRemoval.Id} className="!min-h-11 !px-3 !py-1.5 !text-xs !font-medium disabled:cursor-not-allowed disabled:opacity-50"
					>
						{t("dockerPage.removeDialog.confirmBtn")}
					</ActionButton>
				</div>
			</div>
		</div>
	);
}

export function DockerLogsDialog({
	logsId,
	logs,
	t,
	logsDialogRef,
	logsCloseButtonRef,
	closeLogsDialog,
}: {
	logsId: string | null;
	logs: string;
	t: (key: string, vars?: Record<string, string | number>) => string;
	logsDialogRef: RefObject<HTMLDivElement | null>;
	logsCloseButtonRef: Ref<HTMLButtonElement>;
	closeLogsDialog: () => void;
}) {
	if (!logsId) return null;
	return (
		<div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-[var(--overlay)] p-0 backdrop-blur-sm sm:items-center sm:p-4" role="presentation" onClick={closeLogsDialog}>
			<div
				ref={logsDialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="docker-logs-dialog-title"
				tabIndex={-1}
				className="flex w-full max-w-2xl mx-0 max-h-[92vh] flex-col rounded-t-2xl border border-[var(--border)] bg-[var(--modal-bg)] p-5 shadow-2xl sm:mx-4 sm:max-h-[80vh] sm:rounded-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-center justify-between mb-3">
					<h3 id="docker-logs-dialog-title" className="text-sm font-medium text-[var(--text-primary)]">{t("dockerPage.logsDialog.title", { id: logsId.slice(0, 12) })}</h3>
					<ActionButton variant="ghost"
						ref={logsCloseButtonRef}
						onClick={closeLogsDialog}
						aria-label={t("dockerPage.logsDialog.closeAria")} className="!min-h-11 !min-w-11 !p-1"
					>
						<svg className="w-5 h-5" aria-hidden="true" fill="none" stroke="currentColor" width="24" height="24" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
					</ActionButton>
				</div>
				<pre className="flex-1 overflow-auto text-[11px] text-[var(--text-secondary)] bg-[color-mix(in_srgb,var(--surface-subtle)_85%,#000)] rounded-lg p-3 font-mono whitespace-pre-wrap">{logs}</pre>
			</div>
		</div>
	);
}
