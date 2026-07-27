"use client";

import { useCallback, useState } from "react";
import { useI18n } from "@/lib/i18n/use-locale";
import { useRouter } from "next/navigation";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { getErrorMessage } from "@/lib/http/error-message";
import { ActionButton } from "@/components/action-button";
import { ModalShell } from "@/components/modal-shell";
import { FormField, Notice } from "@/components/ui-primitives";
import { UI_INPUT } from "@/lib/ui/classes";

type Props = {
  commandRequestId: string;
  commandTitle: string;
};

export function CancelCommandButton({ commandRequestId, commandTitle }: Props) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleClose = useCallback(() => {
    setOpen(false);
    setError(null);
  }, []);

  const submit = async () => {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      await csrfFetch("/api/commands", {
        method:"PATCH",
        headers: {"content-type":"application/json" },
        body: JSON.stringify({
          action:"cancel",
          commandRequestId,
          reason: reason.trim() || undefined,
        }),
      });
      setMessage(t("requestsPage.cancel.successMessage"));
      setOpen(false);
      setReason("");
      router.refresh();
    } catch (cancelError) {
      setError(getErrorMessage(cancelError, t("requestsPage.cancel.errorFallback")));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mt-3 space-y-2">
      <ActionButton variant="danger"
        onClick={() => setOpen(true)} className="!px-3 !py-1.5 !text-xs !font-medium"
        aria-label={`${t("requestsPage.cancel.ariaLabel")}: ${commandTitle}`}
      >
        {t("requestsPage.cancel.title")}
      </ActionButton>
      {message && <Notice tone="success" compact>{message}</Notice>}
      {error && <Notice tone="danger" compact>{error}</Notice>}

      <ModalShell
        open={open}
        onClose={handleClose}
        labelledBy={`cancel-command-${commandRequestId}-title`}
        closeOnBackdrop={false}
        overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-[var(--surface)]/70 px-4 py-6"
        panelClassName="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--modal-bg)] p-5 shadow-2xl"
      >
            <h3 id={`cancel-command-${commandRequestId}-title`} className="text-lg font-semibold text-[var(--text-primary)]">{t("requestsPage.cancel.confirmTitle")}</h3>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              {t("requestsPage.cancel.confirmBody", { title: commandTitle })}
            </p>
            <FormField label={t("requestsPage.cancel.reasonLabel")} htmlFor={`cancel-command-${commandRequestId}-reason`} className="mt-4">
            <textarea
              id={`cancel-command-${commandRequestId}-reason`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className={`${UI_INPUT} min-h-20`}
              placeholder={t("requestsPage.cancel.reasonPlaceholder")}
            />
            </FormField>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <ActionButton variant="secondary"
                disabled={pending}
                onClick={() => {
                  setOpen(false);
                  setError(null);
                }}
                className="!px-4 !py-2 !text-sm disabled:opacity-50"
              >
                {t("requestsPage.cancel.keep")}
              </ActionButton>
              <ActionButton variant="danger-solid"
                disabled={pending}
                onClick={submit} className="!px-4 !py-2 !text-sm disabled:opacity-50"
              >
                {pending ? t("requestsPage.cancel.pending") : t("requestsPage.cancel.confirm")}
              </ActionButton>
            </div>
      </ModalShell>
    </div>
  );
}
