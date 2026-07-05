"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";

import { useI18n } from "@/lib/i18n/use-locale";
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
 const { t } = useI18n();
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
        data-tone="emerald" className="rounded-lg border border-[var(--success-border)] px-4 py-2 text-sm font-medium text-[var(--success)] transition hover:bg-[var(--success-bg)]"
      >
        {t("common.restore")}
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
