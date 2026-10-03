"use client";

import { useCallback, useState } from "react";
import { useI18n } from "@/lib/i18n/use-locale";
import { useRouter } from "next/navigation";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { getErrorMessage } from "@/lib/http/error-message";
import { ActionButton } from "@/components/action-button";
import { Dialog } from "@/components/ui/dialog";
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
      <ActionButton size="sm" variant="danger"
        onClick={() => setOpen(true)} 
        aria-label={`${t("requestsPage.cancel.ariaLabel")}: ${commandTitle}`}>
        {t("requestsPage.cancel.title")}
      </ActionButton>
      {message && <Notice tone="success" compact>{message}</Notice>}
      {error && <Notice tone="danger" compact>{error}</Notice>}

      <Dialog
        open={open}
        onClose={handleClose}
        busy={pending}
        closeOnBackdrop={false}
        title={t("requestsPage.cancel.confirmTitle")}
        description={t("requestsPage.cancel.confirmBody", { title: commandTitle })}
        footer={<>
          <ActionButton variant="secondary"
            disabled={pending}
            onClick={() => {
              setOpen(false);
              setError(null);
            }}>
            {t("requestsPage.cancel.keep")}
          </ActionButton>
          <ActionButton variant="danger-solid" loading={pending} onClick={submit}>
            {pending ? t("requestsPage.cancel.pending") : t("requestsPage.cancel.confirm")}
          </ActionButton>
        </>}
      >
        <FormField label={t("requestsPage.cancel.reasonLabel")} htmlFor={`cancel-command-${commandRequestId}-reason`}>
          <textarea
            id={`cancel-command-${commandRequestId}-reason`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className={`${UI_INPUT} min-h-20`}
            placeholder={t("requestsPage.cancel.reasonPlaceholder")}
          />
        </FormField>
      </Dialog>
    </div>
  );
}
