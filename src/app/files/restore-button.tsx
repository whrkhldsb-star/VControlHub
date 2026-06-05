"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";

import { restoreFileEntryAction, type StorageActionState } from "../storage/actions";

const initialState: StorageActionState = {};

export function RestoreButton({
	fileEntryId,
	onRefresh,
}: {
 fileEntryId: string;
 entryName: string;
 onRefresh?: () => void;
}) {
 const router = useRouter();
 const [state, formAction] = useActionState(restoreFileEntryAction, initialState);

 useEffect(() => {
 if (!state.success) return;
 if (onRefresh) { onRefresh(); } else { router.refresh(); }
 }, [onRefresh, router, state.success]);

  return (
    <form action={formAction} className="inline-flex items-center gap-3">
      <input type="hidden" name="fileEntryId" value={fileEntryId} />
      <button
        type="submit"
        className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm font-medium text-emerald-100 light:text-emerald-900 transition hover:bg-emerald-400/20"
      >
        恢复
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
