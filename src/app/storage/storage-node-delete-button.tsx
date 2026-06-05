"use client";

import { useActionState, useState } from "react";

import { deleteStorageNodeAction, type StorageActionState } from "./actions";

const initialState: StorageActionState = {};

export function StorageNodeDeleteButton({
	storageNodeId,
	nodeName,
}: {
	storageNodeId: string;
	nodeName: string;
}) {
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
				title="删除"
				className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-rose-400/30 bg-rose-400/10 text-rose-100 light:text-rose-900 transition hover:bg-rose-400/20"
			>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
			</button>
		);
	}

	return (
		<form action={formAction} className="flex flex-wrap items-center gap-3">
			<input type="hidden" name="storageNodeId" value={storageNodeId} />
			<span className="text-sm text-rose-200 light:text-rose-800">
				确认删除「{nodeName}」？
			</span>
			<button
				type="submit"
				className="rounded-full border border-rose-400/30 bg-rose-400/10 px-4 py-2 text-sm font-medium text-rose-100 light:text-rose-900 transition hover:bg-rose-400/20"
			>
				确认
			</button>
			<button
				type="button"
				onClick={handleCancel}
				className="rounded-full border border-white/10 light:border-slate-200 bg-white/5 px-4 py-2 text-sm font-medium text-slate-300 light:text-slate-700 transition hover:bg-white/10"
			>
				取消
			</button>
			{state.error ? (
				<span className="text-xs text-rose-300">{state.error}</span>
			) : null}
			{state.success ? (
				<span className="text-xs text-emerald-300 light:text-emerald-700">{state.success}</span>
			) : null}
		</form>
	);
}
