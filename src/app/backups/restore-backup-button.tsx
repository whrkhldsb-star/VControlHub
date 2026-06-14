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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openConfirm = () => {
    setConfirmText("");
    setMessage(null);
    setError(null);
    setConfirmOpen(true);
  };

  const handleRestore = async () => {
    if (confirmText !== CONFIRM_TEXT) {
      setError(`请输入 ${CONFIRM_TEXT} 以确认恢复。`);
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
      setConfirmOpen(false);
      setConfirmText("");
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
        onClick={openConfirm}
        className="w-fit rounded-lg border border-rose-300/40 px-3 py-1.5 text-xs font-semibold text-rose-100 transition hover:bg-rose-300/10 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "正在恢复..." : "执行恢复"}
      </button>
      {message && <p className="text-xs text-emerald-300">{message}</p>}
      {error && <p className="text-xs text-rose-300">{error}</p>}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-slate-950/75 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="presentation">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="restore-backup-title"
            aria-describedby="restore-backup-description"
            className="mx-0 w-full max-w-md rounded-t-2xl border border-rose-400/30 bg-slate-950 p-5 shadow-2xl shadow-black/30 sm:mx-4 sm:rounded-2xl"
          >
            <h3 id="restore-backup-title" className="text-base font-semibold text-white">确认恢复备份</h3>
            <p id="restore-backup-description" className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
              恢复 <span className="font-semibold text-white">{backupType}</span> 备份会覆盖当前数据/文件。请输入 <span className="font-mono font-semibold text-rose-200">{CONFIRM_TEXT}</span> 后继续。
            </p>
            <label className="mt-4 grid gap-1 text-sm text-[var(--text-secondary)]">
              输入 RESTORE 确认恢复
              <input
                value={confirmText}
                onChange={(event) => setConfirmText(event.target.value)}
                autoFocus
                className="min-h-11 rounded-xl border border-[var(--border)] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none placeholder:text-slate-600 light:placeholder:text-slate-500 focus:border-rose-300/60"
                placeholder={CONFIRM_TEXT}
              />
            </label>
            {error && <p role="alert" className="mt-3 text-xs text-rose-300">{error}</p>}
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setConfirmOpen(false);
                  setConfirmText("");
                  setError(null);
                }}
                className="min-h-11 rounded-xl border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:bg-white/5 disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                disabled={pending || confirmText !== CONFIRM_TEXT}
                onClick={handleRestore}
                data-tone="rose" className="min-h-11 rounded-xl border border-rose-400/30 px-4 py-2 text-sm font-semibold text-rose-100 transition hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending ? "正在恢复..." : "确认恢复"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
