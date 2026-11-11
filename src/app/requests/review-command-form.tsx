"use client";

import { useActionState } from "react";

import { SubmitButton } from "@/components/submit-button";
import { usePreservedActionForm } from "@/lib/forms/use-preserved-action-form";
import { useI18n } from "@/lib/i18n/use-locale";

import { reviewCommandAction, type ReviewActionState } from "./actions";
import { UI_INPUT } from "@/lib/ui/classes";
import { Notice } from "@/components/ui-primitives";

const initialState: ReviewActionState = {};

export function ReviewCommandForm({ commandRequestId }: { commandRequestId: string }) {
  const { t } = useI18n();
  const [state, formAction] = useActionState(reviewCommandAction, initialState);
  // React clears the fields of a form whose action has answered: a refused decision took the comment with it.
  const { formRef, captureBeforeSubmit } = usePreservedActionForm(state, Boolean(state.error));

  return (
    <form ref={formRef} action={formAction} onSubmit={captureBeforeSubmit} data-tile className="mt-4 p-4 text-sm text-[var(--text-secondary)]">
      <input type="hidden" name="commandRequestId" value={commandRequestId} />
      <label className="grid gap-2">
        <span className="text-[var(--text-secondary)]">{t("requestsPage.review.commentLabel")}</span>
        <textarea name="comment" rows={2} className={UI_INPUT} placeholder={t("requestsPage.review.commentPlaceholder")} />
      </label>

      {state.error ? <Notice tone="danger" className="mt-3">{state.error}</Notice> : null}
      {state.success ? <Notice tone="success" className="mt-3">{state.success}</Notice> : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <SubmitButton
          pendingLabel={t("requestsPage.review.pending")}
          name="decision"
          value="approve"
          variant="primary"
        >
          <span>{t("requestsPage.review.approve")}</span>
        </SubmitButton>
        <SubmitButton
          pendingLabel={t("requestsPage.review.pending")}
          name="decision"
          value="reject"
          variant="danger"
        >
          <span>{t("requestsPage.review.reject")}</span>
        </SubmitButton>
      </div>
    </form>
  );
}
