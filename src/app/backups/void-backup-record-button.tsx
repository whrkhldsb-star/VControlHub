"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { csrfFetch } from "@/lib/auth/csrf-client";

type Props = {
  backupId: string;
  status: string;
};

export function VoidBackupRecordButton({ backupId, status }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const disabled = pending || status === "COMPLETED" || status === "RUNNING";

  const handleVoid = async () => {
    if (disabled) return;
    setPending(true);
    setMessage(null);
    setError(null);
    try {
      await csrfFetch(`/api/backups/${backupId}/void`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "管理员在备份记录页手动作废：历史 PENDING/FAILED 记录不再等待执行或恢复。" }),
      });
      setMessage("已标记为作废记录");
      router.refresh();
    } catch (voidError) {
      setError(voidError instanceof Error ? voidError.message : "作废记录失败");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid gap-1">
      <button
        type="button"
        disabled={disabled}
        onClick={handleVoid}
        className="w-fit rounded-lg border border-amber-300/40 px-3 py-1.5 text-xs font-semibold text-amber-100 transition hover:bg-amber-300/10 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "正在作废..." : "标记作废"}
      </button>
      {message && <p className="text-xs text-emerald-300">{message}</p>}
      {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
    </div>
  );
}
