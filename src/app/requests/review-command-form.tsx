"use client";

import { useActionState } from "react";

import { SubmitButton } from "@/components/submit-button";

import { reviewCommandAction, type ReviewActionState } from "./actions";

const initialState: ReviewActionState = {};

export function ReviewCommandForm({ commandRequestId }: { commandRequestId: string }) {
  const [state, formAction] = useActionState(reviewCommandAction, initialState);

  return (
    <form action={formAction} className="mt-4 rounded-lg border border-white/[0.06] bg-white/[0.03] p-4 text-sm text-slate-300 light:text-slate-700">
      <input type="hidden" name="commandRequestId" value={commandRequestId} />
      <label className="grid gap-2">
        <span className="text-slate-400 light:text-slate-600">审批意见</span>
        <textarea name="comment" rows={2} className="rounded-2xl border border-white/10 light:border-slate-200 bg-slate-950 light:bg-white px-4 py-3 text-white outline-none ring-0" placeholder="可填写批准原因、执行窗口、注意事项等" />
      </label>

      {state.error ? <div className="mt-3 rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-rose-100 light:text-rose-900">{state.error}</div> : null}
      {state.success ? <div className="mt-3 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-emerald-100 light:text-emerald-900">{state.success}</div> : null}

      <div className="mt-4 flex flex-wrap gap-3">
        <SubmitButton
          pendingLabel="处理中..."
          name="decision"
          value="approve"
          className="rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span>批准执行</span>
        </SubmitButton>
        <button type="submit" name="decision" value="reject" className="rounded-2xl border border-white/10 light:border-slate-200 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10">
          拒绝请求
        </button>
      </div>
    </form>
  );
}
