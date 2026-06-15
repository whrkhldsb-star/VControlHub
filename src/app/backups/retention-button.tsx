"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { csrfFetch } from "@/lib/auth/csrf-client";

type Props = {
  /** 当前已超过 30 天的记录数。0 时按钮 disabled。 */
  olderThan30Days: number;
  /** 整个 backups 总数（包含 FAILED / PENDING / RUNNING），用于决策提示。 */
  totalRecords: number;
};

const MIN_OLDER_THAN_DAYS = 30;
const DEFAULT_KEEP_LATEST_PER_TYPE = 3;

export function RetentionButton({ olderThan30Days, totalRecords }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [olderThanDays, setOlderThanDays] = useState(MIN_OLDER_THAN_DAYS);
  const [keepLatestPerType, setKeepLatestPerType] = useState(DEFAULT_KEEP_LATEST_PER_TYPE);

  const disabled = pending || olderThan30Days === 0;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled) return;
    setPending(true);
    setTaskId(null);
    setError(null);
    try {
      const result = await csrfFetch("/api/backups/retention", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          olderThanDays: Number(olderThanDays) || MIN_OLDER_THAN_DAYS,
          keepLatestPerType: Number(keepLatestPerType),
        }),
      });
      setTaskId(result?.taskId ?? null);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "清理旧备份失败");
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="grid gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-xs text-slate-500">
          <span>保留天数阈值（超过此天数的备份将被评估）</span>
          <input
            type="number"
            min={1}
            max={3650}
            value={olderThanDays}
            onChange={(event) => setOlderThanDays(Math.max(1, Math.min(3650, Number(event.target.value) || MIN_OLDER_THAN_DAYS)))}
            className="w-24 rounded-md border border-white/[0.08] bg-black/20 px-2 py-1 text-sm text-white light:bg-white/70"
            disabled={pending}
          />
        </label>
        <label className="grid gap-1 text-xs text-slate-500">
          <span>每类型保留最新 N 个（0 = 全清）</span>
          <input
            type="number"
            min={0}
            max={1000}
            value={keepLatestPerType}
            onChange={(event) => setKeepLatestPerType(Math.max(0, Math.min(1000, Number(event.target.value) || 0)))}
            className="w-24 rounded-md border border-white/[0.08] bg-black/20 px-2 py-1 text-sm text-white light:bg-white/70"
            disabled={pending}
          />
        </label>
        <button
          type="submit"
          disabled={disabled}
          className="rounded-lg border border-amber-300/40 px-3 py-1.5 text-xs font-semibold text-amber-100 transition hover:bg-amber-300/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "正在排队清理..." : "清理旧备份"}
        </button>
      </div>
      <p className="text-xs text-slate-500">
        匹配 {totalRecords} 条备份记录，当前 {olderThan30Days} 条超过 30 天。系统会删除「保留窗口外且超过保留天数」以及「保留窗口内但超过保留天数」两类记录，并在任务中心产生一条 <code>backup.retention</code> 任务记录。
      </p>
      {taskId && (
        <p role="status" className="text-xs text-emerald-300">
          已加入清理队列，详情可在 <Link href="/operation-tasks" className="underline">任务中心</Link> 查看（{taskId}）。
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-rose-300">清理失败：{error}</p>
      )}
    </form>
  );
}
