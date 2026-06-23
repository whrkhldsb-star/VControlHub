"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { csrfFetch } from "@/lib/auth/csrf-client";

type Props = {
  runId: string;
  templateName: string;
  disabled?: boolean;
};

export function RollbackDeployButton({ runId, templateName, disabled = false }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRollback() {
    if (pending || disabled) return;
    if (!confirming) {
      setError(null);
      setConfirming(true);
      return;
    }

    setPending(true);
    setError(null);
    try {
      await csrfFetch(`/api/deployments/${runId}/rollback`, {
        method: "POST",
        body: JSON.stringify({ reason: `真实回滚：${templateName}` }),
      });
      setConfirming(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "回滚失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {confirming ? (
        <span id={`rollback-deploy-${runId}-warning`} className="text-xs text-amber-200">
          确认执行部署「{templateName}」的回滚命令？该操作会进入审批链路并在目标 VPS 上执行快照中的 rollback command。
        </span>
      ) : null}
      <button
        type="button"
        onClick={handleRollback}
        disabled={pending || disabled}
        aria-describedby={confirming ? `rollback-deploy-${runId}-warning` : undefined}
        data-tone="emerald" className="rounded-lg border border-emerald-400/30 px-3 py-1.5 text-xs font-medium text-emerald-200 transition hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "提交中..." : confirming ? "确认回滚" : "执行真实回滚"}
      </button>
      {confirming ? (
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            setError(null);
          }}
          disabled={pending}
          className="rounded-lg border border-[var(--border)] bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          取消
        </button>
      ) : null}
      {error && <span role="alert" className="text-xs text-rose-300">{error}</span>}
    </div>
  );
}
