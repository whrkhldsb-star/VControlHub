"use client";

import type { RefObject } from "react";
import { ActionButton } from "@/components/action-button";
import { copyText } from "@/lib/ui/clipboard";
import { UI_INPUT } from "@/lib/ui/classes";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { type Container, getContainerName } from "./docker-helpers";

export function DockerRemovalDialog({
	pendingRemoval, error,
	t,
	actionLoading,
	removeCancelButtonRef,
	closeRemovalDialog,
	confirmRemoval,
}: {
	pendingRemoval: Container | null; error: string;
	t: (key: string, vars?: Record<string, string | number>) => string;
	actionLoading: string | null;
	removeCancelButtonRef: RefObject<HTMLButtonElement | null>;
	closeRemovalDialog: () => void;
	confirmRemoval: () => Promise<void>;
}) {
	if (!pendingRemoval) return null;
	return (
		<ConfirmDialog
			open
			title={t("dockerPage.removeDialog.title")}
			description={t("dockerPage.removeDialog.confirm", { name: getContainerName(t, pendingRemoval) })}
			cancelLabel={t("dockerPage.removeDialog.cancel")}
			confirmLabel={t("dockerPage.removeDialog.confirmBtn")}
			onCancel={closeRemovalDialog}
			onConfirm={() => void confirmRemoval()}
			error={error}
			busy={actionLoading === pendingRemoval.Id}
			cancelButtonRef={removeCancelButtonRef}
		/>
	);
}

export function DockerLogsDialog({
	logsId, name, tail, fetchLogs,
	logs,
	t,
	logsCloseButtonRef,
	closeLogsDialog,
}: {
	logsId: string | null; name?: string; tail: number; fetchLogs: (id: string, tail: number) => Promise<void>;
	logs: string;
	t: (key: string, vars?: Record<string, string | number>) => string;
	logsCloseButtonRef: RefObject<HTMLButtonElement | null>;
	closeLogsDialog: () => void;
}) {
	if (!logsId) return null;
	return (
		<Dialog
			open
			size="xl"
			placement="sheet"
			onClose={closeLogsDialog}
			title={t("dockerPage.logsDialog.title", { id: name ?? logsId.slice(0, 12) })}
			closeLabel={t("dockerPage.logsDialog.closeAria")}
			closeButtonRef={logsCloseButtonRef}
			initialFocusRef={logsCloseButtonRef}
			bodyClassName="flex flex-col gap-3 sm:max-h-[70vh]"
		>
			<div className="flex flex-wrap items-center gap-2">
				<label className="ui-label">{t("dockerPage.logsDialog.tail")} <select className={UI_INPUT} value={tail} onChange={e => void fetchLogs(logsId, Number(e.target.value))}>{[50, 200, 500].map(n => <option key={n}>{n}</option>)}</select></label>
				<ActionButton size="sm" variant="secondary" onClick={() => void fetchLogs(logsId, tail)}>{t("common.refresh")}</ActionButton>
				<ActionButton size="sm" variant="secondary" disabled={!logs} onClick={() => void copyText(logs)}>{t("dockerPage.logsDialog.copy")}</ActionButton>
			</div>
			<pre data-inset className="min-h-40 flex-1 overflow-auto whitespace-pre-wrap p-3 font-mono text-xs text-[var(--text-secondary)]">{logs}</pre>
		</Dialog>
	);
}
