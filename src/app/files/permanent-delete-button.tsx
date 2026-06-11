"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { permanentDeleteFileEntryAction, type StorageActionState } from "../storage/actions";

const initialState: StorageActionState = {};

export function PermanentDeleteButton({
 fileEntryId,
 entryName,
 onRefresh,
}: {
 fileEntryId: string;
 entryName: string;
 onRefresh?: () => void;
}) {
 const router = useRouter();
 const [confirming, setConfirming] = useState(false);
 const [state, formAction] = useActionState(permanentDeleteFileEntryAction, initialState);

 function handleCancel() {
 setConfirming(false);
 }

 useEffect(() => {
 if (!state.success) return;
 if (onRefresh) { onRefresh(); } else { router.refresh(); }
 }, [onRefresh, router, state.success]);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-full border border-rose-400/30 bg-rose-400/10 px-4 py-2 text-sm font-medium text-rose-100 light:text-rose-900 transition hover:bg-rose-400/20"
      >
        永久删除
      </button>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="fileEntryId" value={fileEntryId} />
      <span className="text-sm text-rose-200 light:text-rose-800">
        ⚠️ 永久删除 {entryName}？此操作不可恢复！
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
        className="rounded-full border border-[var(--border)] bg-white/5 px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition hover:bg-white/10"
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
