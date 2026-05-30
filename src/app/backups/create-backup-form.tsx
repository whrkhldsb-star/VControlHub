"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { createBackupAction, type BackupActionState } from "./actions";

const initialState: BackupActionState = { success: false };

export function CreateBackupForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [state, formAction, pending] = useActionState(createBackupAction, initialState);

  useEffect(() => {
    if (!state.success) return;
    formRef.current?.reset();
    router.refresh();
  }, [router, state.success]);

  return (
    <form ref={formRef} action={formAction} className="mt-4 grid gap-3 md:grid-cols-[180px_1fr_auto]">
      <select name="type" defaultValue="DATABASE" className="rounded-lg border border-white/[0.08] bg-slate-950 px-3 py-2 text-sm text-slate-100">
        <option value="DATABASE">数据库备份</option>
        <option value="FILES">文件备份</option>
        <option value="FULL">完整备份</option>
      </select>
      <input name="note" maxLength={500} placeholder="备注：例如升级前备份" className="rounded-lg border border-white/[0.08] bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600" />
      <button disabled={pending} className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60">
        {pending ? "执行中" : "创建并执行"}
      </button>
      {state.error && <p className="md:col-span-3 text-xs text-rose-300">{state.error}</p>}
    </form>
  );
}
