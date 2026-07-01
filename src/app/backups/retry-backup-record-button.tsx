"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { csrfFetch } from "@/lib/auth/csrf-client";

type Props = {
  backupId: string;
  status: string;
};

export function RetryBackupRecordButton({ backupId, status }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const disabled = pending || status !== "FAILED";

  const handleRetry = async () => {
    if (disabled) return;
    setPending(true);
    setTaskId(null);
    setError(null);
    try {
      const result = await csrfFetch(`/api/backups/${backupId}/retry`, { method: "POST" });
      setTaskId(result?.taskId ?? null);
      router.refresh();
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "重试备份失败");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid gap-1">
      <button
        type="button"
        disabled={disabled}
        onClick={handleRetry}
        className="w-fit rounded-lg border border-cyan-300/40 px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] transition hover:bg-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "正在排队..." : "重试备份"}
      </button>
      {taskId && (
        <p role="status" className="text-xs text-emerald-300">
          已重新排队，可在 <Link href="/operation-tasks" className="underline">任务中心</Link> 查看进度（{taskId}）。
        </p>
      )}
      {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
    </div>
  );
}
