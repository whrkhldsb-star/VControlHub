"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { csrfFetch } from "@/lib/auth/csrf-client";

type Props = {
  backupId: string;
  backupType: string;
  disabled?: boolean;
};

const CONFIRM_TEXT = "RESTORE";

export function RestoreBackupButton({ backupId, backupType, disabled = false }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRestore = async () => {
    const confirmed = window.prompt(`恢复 ${backupType} 备份会覆盖当前数据/文件。请输入 ${CONFIRM_TEXT} 确认。`);
    if (confirmed !== CONFIRM_TEXT) {
      setMessage(null);
      setError("已取消恢复：确认文本不匹配。");
      return;
    }

    setPending(true);
    setMessage(null);
    setError(null);
    try {
      const result = await csrfFetch(`/api/backups/${backupId}/restore`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: CONFIRM_TEXT }),
      }) as { restoredAt?: string; error?: string };
      setMessage(result.restoredAt ? `恢复已执行：${new Date(result.restoredAt).toLocaleString("zh-CN")}` : "恢复已执行");
      router.refresh();
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "恢复执行失败");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid gap-1">
      <button
        type="button"
        disabled={disabled || pending}
        onClick={handleRestore}
        className="w-fit rounded-lg border border-rose-300/40 px-3 py-1.5 text-xs font-semibold text-rose-100 transition hover:bg-rose-300/10 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "正在恢复..." : "执行恢复"}
      </button>
      {message && <p className="text-xs text-emerald-300">{message}</p>}
      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  );
}
