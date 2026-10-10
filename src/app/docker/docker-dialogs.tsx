"use client";

import type { RefObject } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
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
		<ConfirmDialog
			open
			title={t("dockerPage.removeDialog.title")}
			description={t("dockerPage.removeDialog.confirm", { name: getContainerName(t, pendingRemoval) })}
			cancelLabel={t("dockerPage.removeDialog.cancel")}
			confirmLabel={t("dockerPage.removeDialog.confirmBtn")}
			onCancel={closeRemovalDialog}
			onConfirm={() => void confirmRemoval()}
			busy={actionLoading === pendingRemoval.Id}
			cancelButtonRef={removeCancelButtonRef}
		/>
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
		<Dialog
			open
			size="xl"
			placement="sheet"
			onClose={closeLogsDialog}
			title={t("dockerPage.logsDialog.title", { id: logsId.slice(0, 12) })}
			closeLabel={t("dockerPage.logsDialog.closeAria")}
			closeButtonRef={logsCloseButtonRef}
			initialFocusRef={logsCloseButtonRef}
			bodyClassName="flex sm:max-h-[70vh]"
		>
			<pre data-inset className="min-h-40 flex-1 overflow-auto whitespace-pre-wrap p-3 font-mono text-xs text-[var(--text-secondary)]">{logs}</pre>
		</Dialog>
	);
}
