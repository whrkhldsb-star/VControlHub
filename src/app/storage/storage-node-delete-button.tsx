"use client";

import { useActionState, useState } from "react";

import { useI18n } from "@/lib/i18n/use-locale";
import { deleteStorageNodeAction, type StorageActionState } from "./actions";
import { ActionButton } from "@/components/action-button";
import { Trash2 } from "@/components/icons";

const initialState: StorageActionState = {};

export function StorageNodeDeleteButton({
	storageNodeId,
	nodeName,
}: {
	storageNodeId: string;
	nodeName: string;
}) {
	const { t } = useI18n();
	const [confirming, setConfirming] = useState(false);
	// `pending` disables the buttons while the action runs; the confirm row
	// folds away once the node is gone (A4-38).
	const [state, formAction, pending] = useActionState(deleteStorageNodeAction, initialState);

	function handleCancel() {
		setConfirming(false);
	}

	// After a successful delete the row is gone with the node; show the plain button again rather than a stale confirm.
	if (!confirming || state.success) {
		return (
			<ActionButton
				variant="danger"
				square
				onClick={() => setConfirming(true)}
				title={t("common.delete")}
				aria-label={t("common.delete")}
			>
				<Trash2 size={14} aria-hidden />
			</ActionButton>
		);
	}

	return (
		<form action={formAction} className="flex flex-wrap items-center gap-3">
			<input type="hidden" name="storageNodeId" value={storageNodeId} />
			<span className="text-sm text-[var(--danger)]">
				{t("storagePage.delete.confirmNode", { name: nodeName })}
			</span>
			<ActionButton variant="danger"
				type="submit"
				data-tone="rose"
				loading={pending}
				disabled={pending}
			>
				{t("common.confirmDelete")}
			</ActionButton>
			<ActionButton variant="secondary"
				disabled={pending}
				onClick={handleCancel}>
				{t("common.cancel")}
			</ActionButton>
			{state.error ? (
				<span className="text-xs text-[var(--danger)]">{state.error}</span>
			) : null}
		</form>
	);
}
