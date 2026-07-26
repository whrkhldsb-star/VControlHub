"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useI18n } from "@/lib/i18n/use-locale";
import { permanentDeleteFileEntryAction, type StorageActionState } from "../storage/actions";
import { ActionButton } from "@/components/action-button";

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
 const [state, formAction, pending] = useActionState(permanentDeleteFileEntryAction, initialState);

 function handleCancel() {
 setConfirming(false);
 }

 useEffect(() => {
 if (!state.success) return;
 if (onRefresh) { onRefresh(); } else { router.refresh(); }
 }, [onRefresh, router, state.success]);

  if (!confirming) {
    return (
      <ActionButton variant="danger"
        onClick={() => setConfirming(true)}
        data-tone="rose"
      >
        {t("filesPage.actions.permanentDelete")}
      </ActionButton>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="fileEntryId" value={fileEntryId} />
      <span className="text-sm text-[var(--danger)]">
        {t("filesPage.actions.permanentDeleteWarning").replace("{name}", entryName)}
      </span>
      <ActionButton variant="danger"
        type="submit"
        disabled={pending}
        data-tone="rose"
        className="disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? t("common.executing") : t("common.confirm")}
      </ActionButton>
      <ActionButton variant="secondary"
        onClick={handleCancel}
        disabled={pending} className="!px-4 !py-2 !text-sm disabled:cursor-not-allowed disabled:opacity-50">
        {t("common.cancel")}
      </ActionButton>
      {state.error ? (
        <span className="text-xs text-[var(--danger)]">{state.error}</span>
      ) : null}
      {state.success ? (
        <span className="text-xs text-[var(--success)]">{state.success}</span>
      ) : null}
    </form>
  );
}
