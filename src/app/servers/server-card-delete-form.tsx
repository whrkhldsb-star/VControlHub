"use client";

import { useRouter } from "next/navigation";

import { SubmitButton } from "@/components/submit-button";
import { useI18n } from "@/lib/i18n/use-locale";
import type { ServerActionState } from "./actions";

type Props = {
  serverId: string;
  serverName: string;
  deleteAction: (formData: FormData) => void | Promise<void>;
  deleteState: ServerActionState;
};

export function ServerCardDeleteForm({
  serverId,
  serverName,
  deleteAction,
  deleteState,
}: Props) {
  const { t } = useI18n();
  const router = useRouter();
  const isConfirming =
    deleteState.relatedStorageCount !== undefined &&
    !deleteState.success &&
    !deleteState.error;
  const relatedStorageCount = deleteState.relatedStorageCount ?? 0;

  return (
    <form action={deleteAction} className="space-y-2">
      <input type="hidden" name="serverId" value={serverId} />
      {isConfirming ? (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={`delete-server-title-${serverId}`}
          aria-describedby={`delete-server-description-${serverId}`}
          data-tone="rose"
          className="space-y-3 rounded-2xl border border-[var(--danger-border)] p-3 light:bg-[var(--danger-bg)]"
        >
          <input type="hidden" name="confirmDelete" value="true" />
          <div className="space-y-1 text-sm text-[var(--danger)]">
            <p id={`delete-server-title-${serverId}`} className="font-semibold">
              {t("serversPage.delete.confirmTitle").replace("{name}", serverName)}
            </p>
            <div id={`delete-server-description-${serverId}`}>
              {relatedStorageCount > 0 ? (
                <p className="mt-1 text-xs text-[var(--danger)]">
                  {t("serverCardActions.delete.relatedStorageHint").replace(
                    "{count}",
                    String(relatedStorageCount),
                  )}
                </p>
              ) : null}
              <p className="mt-1 text-xs text-[var(--danger)]">
                {t("serverCardActions.delete.postConfirmHint")}
              </p>
            </div>
          </div>
          <label
            htmlFor={`delete-confirm-name-${serverId}`}
            className="block text-xs font-medium text-[var(--danger)]"
          >
            {t("serversPage.delete.confirmNameInput").replace("{name}", serverName)}
          </label>
          <input
            id={`delete-confirm-name-${serverId}`}
            name="confirmName"
            type="text"
            autoComplete="off"
            className="w-full rounded-lg border border-[var(--danger-border)] bg-[var(--surface-subtle)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--danger)]"
          />
          <div className="flex gap-2">
            <SubmitButton
              pendingLabel={t("serverCardActions.delete.pending")}
              variant="danger"
              className="flex-1"
            >
              {t("common.confirmDelete")}
            </SubmitButton>
            <button
              type="button"
              onClick={() => router.refresh()}
              data-action-button
              data-variant="secondary"
              className="flex-1"
            >
              {t("serverCardActions.delete.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <SubmitButton
          pendingLabel={t("serverCardActions.delete.pendingLookup")}
          variant="danger"
          className="w-full"
        >
          {t("serverCardActions.delete.confirm")}
        </SubmitButton>
      )}
      {deleteState.error ? (
        <div role="alert" className="text-xs text-[var(--danger)]">
          {deleteState.error}
        </div>
      ) : null}
      {deleteState.success ? (
        <div role="status" className="text-xs text-[var(--success)]">
          {deleteState.success}
        </div>
      ) : null}
    </form>
  );
}
