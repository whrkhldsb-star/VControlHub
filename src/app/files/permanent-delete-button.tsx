"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useI18n } from "@/lib/i18n/use-locale";
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
 const { t } = useI18n();
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
        data-tone="rose" className="rounded-lg border border-[var(--danger-border)] px-4 py-2 text-sm font-medium text-[var(--danger)] transition hover:bg-[var(--danger-bg)]"
      >
        {t("filesPage.actions.permanentDelete")}
      </button>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="fileEntryId" value={fileEntryId} />
      <span className="text-sm text-[var(--danger)]">
        {t("filesPage.actions.permanentDeleteWarning").replace("{name}", entryName)}
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
