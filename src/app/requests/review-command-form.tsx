"use client";

import { useActionState } from "react";

import { SubmitButton } from "@/components/submit-button";
import { useI18n } from "@/lib/i18n/use-locale";

import { reviewCommandAction, type ReviewActionState } from "./actions";

const initialState: ReviewActionState = {};

export function ReviewCommandForm({ commandRequestId }: { commandRequestId: string }) {
  const { t } = useI18n();
  const [state, formAction] = useActionState(reviewCommandAction, initialState);

  return (
    <form action={formAction} className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] p-4 text-sm text-[var(--text-secondary)]">
      <input type="hidden" name="commandRequestId" value={commandRequestId} />
      <label className="grid gap-2">
        <span className="text-[var(--text-secondary)]">{t("requestsPage.review.commentLabel")}</span>
        <textarea name="comment" rows={2} className="rounded-2xl border border-[var(--border)] bg-[var(--input-bg)] px-4 py-3 text-[var(--text-primary)] outline-none ring-0" placeholder={t("requestsPage.review.commentPlaceholder")} />
      </label>

      {state.error ? <div data-tone="rose" className="mt-3 rounded-2xl border border-rose-400/30 px-4 py-3 text-rose-100">{state.error}</div> : null}
      {state.success ? <div data-tone="emerald" className="mt-3 rounded-2xl border border-emerald-400/30 px-4 py-3 text-emerald-100">{state.success}</div> : null}

      <div className="mt-4 flex flex-wrap gap-3">
        <SubmitButton
          pendingLabel="处理中..."
          name="decision"
          value="approve"
          className="rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span>{t("requestsPage.review.approve")}</span>
        </SubmitButton>
        <button type="submit" name="decision" value="reject" className="rounded-2xl border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:bg-[var(--surface)]/10">
          {t("requestsPage.review.reject")}
        </button>
      </div>
    </form>
  );
}
