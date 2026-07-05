"use client";

import { useActionState, useState } from "react";

import { useI18n } from "@/lib/i18n/use-locale";
import { deleteStorageNodeAction, type StorageActionState } from "./actions";

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
	const [state, formAction] = useActionState(deleteStorageNodeAction, initialState);

	function handleCancel() {
		setConfirming(false);
	}

	if (!confirming) {
		return (
			<button
				type="button"
				onClick={() => setConfirming(true)}
				title={t("common.delete")}
				data-tone="rose" className="inline-flex items-center justify-center w-11 h-11 rounded-lg border border-[var(--danger-border)] text-[var(--danger)] transition hover:bg-[var(--danger-bg)]"
			>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
			</button>
		);
	}

	return (
		<form action={formAction} className="flex flex-wrap items-center gap-3">
			<input type="hidden" name="storageNodeId" value={storageNodeId} />
			<span className="text-sm text-[var(--danger)]">
				{t("storagePage.delete.confirmNode").replace("{name}", nodeName)}
			</span>
			<button
				type="submit"
				data-tone="rose" className="rounded-lg border border-[var(--danger-border)] px-4 py-2 text-sm font-medium text-[var(--danger)] transition hover:bg-[var(--danger-bg)]"
			>
				{t("common.confirm")}
			</button>
			<button
				type="button"
				onClick={handleCancel}
				className="rounded-lg border border-[var(--border)] bg-[var(--surface)]/10 px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface)]/10"
			>
				{t("common.cancel")}
			</button>
			{state.error ? (
				<span className="text-xs text-[var(--danger)]">{state.error}</span>
			) : null}
			{state.success ? (
				<span className="text-xs text-[var(--success)]">{state.success}</span>
			) : null}
		</form>
	);
}
