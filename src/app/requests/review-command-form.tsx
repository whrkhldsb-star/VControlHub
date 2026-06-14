"use client";

import { useActionState } from "react";

import { SubmitButton } from "@/components/submit-button";

import { reviewCommandAction, type ReviewActionState } from "./actions";

const initialState: ReviewActionState = {};

export function ReviewCommandForm({ commandRequestId }: { commandRequestId: string }) {
  const [state, formAction] = useActionState(reviewCommandAction, initialState);

  return (
    <form action={formAction} className="mt-4 rounded-lg border border-white/[0.06] bg-white/[0.03] p-4 text-sm text-[var(--text-secondary)]">
      <input type="hidden" name="commandRequestId" value={commandRequestId} />
      <label className="grid gap-2">
        <span className="text-[var(--text-secondary)]">审批意见</span>
        <textarea name="comment" rows={2} className="rounded-2xl border border-[var(--border)] bg-slate-950 px-4 py-3 text-white outline-none ring-0" placeholder="可填写批准原因、执行窗口、注意事项等" />
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
          <span>批准执行</span>
        </SubmitButton>
        <button type="submit" name="decision" value="reject" className="rounded-2xl border border-[var(--border)] px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10">
          拒绝请求
        </button>
      </div>
    </form>
  );
}
