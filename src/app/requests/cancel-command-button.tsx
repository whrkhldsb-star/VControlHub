"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { csrfFetch } from "@/lib/auth/csrf-client";

type Props = {
  commandRequestId: string;
  commandTitle: string;
};

export function CancelCommandButton({ commandRequestId, commandTitle }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      await csrfFetch("/api/commands", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "cancel",
          commandRequestId,
          reason: reason.trim() || undefined,
        }),
      });
      setMessage("命令取消请求已提交，任务状态已刷新。");
      setOpen(false);
      setReason("");
      router.refresh();
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "取消命令失败");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mt-3 space-y-2">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-1.5 text-xs font-medium text-rose-100 transition hover:bg-rose-400/20 light:text-rose-700"
        aria-label={`取消命令：${commandTitle}`}
      >
        取消命令
      </button>
      {message && <p role="status" className="text-xs text-emerald-300 light:text-emerald-700">{message}</p>}
      {error && <p role="alert" className="text-xs text-rose-300 light:text-rose-700">{error}</p>}

      {open && (
        <div role="dialog" aria-modal="true" aria-labelledby={`cancel-command-${commandRequestId}-title`} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4 py-6">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-950 p-5 shadow-2xl light:border-slate-200 light:bg-white">
            <h3 id={`cancel-command-${commandRequestId}-title`} className="text-lg font-semibold text-white">确认取消命令</h3>
            <p className="mt-2 text-sm text-slate-400 light:text-slate-600">
              将取消“{commandTitle}”。若 SSH 子进程仍在当前执行器内运行，系统会发送终止信号；否则会把仍处于待审批/已批准/运行中的目标标记为 CANCELLED。
            </p>
            <label htmlFor={`cancel-command-${commandRequestId}-reason`} className="mt-4 block text-sm font-medium text-slate-200">
              取消原因（可选）
            </label>
            <textarea
              id={`cancel-command-${commandRequestId}-reason`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="mt-2 min-h-20 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white outline-none focus:border-rose-300 light:border-slate-200 light:bg-white light:text-slate-900"
              placeholder="例如：维护窗口变更、目标选错、需要重新提交参数……"
            />
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setOpen(false);
                  setError(null);
                }}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/5 disabled:opacity-50 light:border-slate-200 light:text-slate-700"
              >
                保留命令
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={submit}
                className="rounded-xl bg-rose-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-400 disabled:opacity-50"
              >
                {pending ? "取消中…" : "确认取消"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
