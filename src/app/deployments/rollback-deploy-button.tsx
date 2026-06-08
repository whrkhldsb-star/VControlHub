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
  const [error, setError] = useState<string | null>(null);

  async function handleRollback() {
    const confirmed = window.confirm(`确认执行部署「${templateName}」的回滚命令？该操作会进入审批链路并在目标 VPS 上执行快照中的 rollback command。`);
    if (!confirmed) return;
    setPending(true);
    setError(null);
    try {
      await csrfFetch(`/api/deployments/${runId}/rollback`, {
        method: "POST",
        body: JSON.stringify({ reason: `真实回滚：${templateName}` }),
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "回滚失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={handleRollback}
        disabled={pending || disabled}
        className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-xs font-medium text-emerald-200 light:text-emerald-800 transition hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "提交中..." : "执行真实回滚"}
      </button>
      {error && <span className="text-xs text-rose-300">{error}</span>}
    </div>
  );
}
