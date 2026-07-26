"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";

import { useI18n } from "@/lib/i18n/use-locale";
import { restoreFileEntryAction, type StorageActionState } from "../storage/actions";
import { ActionButton } from "@/components/action-button";

const initialState: StorageActionState = {};

export function RestoreButton({
	fileEntryId,
	onRefresh,
}: {
 fileEntryId: string;
 onRefresh?: () => void;
}) {
 const router = useRouter();
 const { t } = useI18n();
 const [state, formAction, isPending] = useActionState(restoreFileEntryAction, initialState);

 useEffect(() => {
 if (!state.success) return;
 if (onRefresh) { onRefresh(); } else { router.refresh(); }
 }, [onRefresh, router, state.success]);

  return (
    <form action={formAction} className="inline-flex items-center gap-3">
      <input type="hidden" name="fileEntryId" value={fileEntryId} />
      <ActionButton variant="success"
        type="submit"
        disabled={isPending}
        aria-busy={isPending || undefined} className="!px-4 !py-2 !text-sm disabled:cursor-not-allowed disabled:opacity-50">
        {isPending ? t("common.restoring") : t("common.restore")}
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
