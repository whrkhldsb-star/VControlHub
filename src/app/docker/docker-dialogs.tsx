"use client";

import type { RefObject } from "react";
import { ActionButton } from "@/components/action-button";
import { ModalShell } from "@/components/modal-shell";
import { type Container, getContainerName } from "./docker-helpers";

export function DockerRemovalDialog({
	pendingRemoval,
	t,
	actionLoading,
	removeCancelButtonRef,
	closeRemovalDialog,
	confirmRemoval,
}: {
	pendingRemoval: Container | null;
	t: (key: string, vars?: Record<string, string | number>) => string;
	actionLoading: string | null;
	removeCancelButtonRef: RefObject<HTMLButtonElement | null>;
	closeRemovalDialog: () => void;
	confirmRemoval: () => Promise<void>;
}) {
	if (!pendingRemoval) return null;
	return (
		<ModalShell
			size="md" placement="sheet"
			open
			onClose={closeRemovalDialog}
			labelledBy="docker-remove-confirm-title"
			initialFocusRef={removeCancelButtonRef}
		>
			<h3 id="docker-remove-confirm-title" className="text-base font-semibold text-[var(--text-primary)]">{t("dockerPage.removeDialog.title")}</h3>
			<p className="mt-3 text-sm text-[var(--text-secondary)]">
				{t("dockerPage.removeDialog.confirm", { name: getContainerName(t, pendingRemoval) })}
			</p>
			<div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
				<ActionButton size="sm" variant="secondary"
					ref={removeCancelButtonRef}
					onClick={closeRemovalDialog}>
					{t("dockerPage.removeDialog.cancel")}
				</ActionButton>
				<ActionButton size="sm" variant="danger-solid"
					onClick={() => void confirmRemoval()}
					disabled={actionLoading === pendingRemoval.Id}>
					{t("dockerPage.removeDialog.confirmBtn")}
				</ActionButton>
			</div>
		</ModalShell>
	);
}

export function DockerLogsDialog({
	logsId,
	logs,
	t,
	logsCloseButtonRef,
	closeLogsDialog,
}: {
	logsId: string | null;
	logs: string;
	t: (key: string, vars?: Record<string, string | number>) => string;
	logsCloseButtonRef: RefObject<HTMLButtonElement | null>;
	closeLogsDialog: () => void;
}) {
	if (!logsId) return null;
	return (
		<ModalShell
			size="xl" placement="sheet" className="flex flex-col sm:max-h-[80vh]"
			open
			onClose={closeLogsDialog}
			labelledBy="docker-logs-dialog-title"
			initialFocusRef={logsCloseButtonRef}
		>
			<div className="flex items-center justify-between mb-3">
				<h3 id="docker-logs-dialog-title" className="text-sm font-medium text-[var(--text-primary)]">{t("dockerPage.logsDialog.title", { id: logsId.slice(0, 12) })}</h3>
				<ActionButton variant="ghost"
					ref={logsCloseButtonRef}
					onClick={closeLogsDialog}
					aria-label={t("dockerPage.logsDialog.closeAria")} square
				>
					<svg className="w-5 h-5" aria-hidden="true" fill="none" stroke="currentColor" width="24" height="24" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
				</ActionButton>
			</div>
			<pre className="flex-1 overflow-auto text-xs text-[var(--text-secondary)] bg-[color-mix(in_srgb,var(--surface-subtle)_85%,#000)] rounded-lg p-3 font-mono whitespace-pre-wrap">{logs}</pre>
		</ModalShell>
	);
}
