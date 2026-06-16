"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/use-locale";

import { createBackupAction, type BackupActionState } from "./actions";

const initialState: BackupActionState = { success: false };
const backupTypeSelectId = "create-backup-type";
const backupNoteInputId = "create-backup-note";

export function CreateBackupForm() {
  const { t } = useI18n();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [state, formAction, pending] = useActionState(createBackupAction, initialState);

  useEffect(() => {
    if (!state.success) return;
    formRef.current?.reset();
    router.refresh();
  }, [router, state.success]);

  return (
    <form ref={formRef} action={formAction} className="mt-4 grid gap-3 md:grid-cols-[180px_1fr_auto] md:items-end">
      <div className="grid gap-1.5">
        <label htmlFor={backupTypeSelectId} className="text-xs font-medium text-[var(--text-secondary)]">{t("common.backupType")}</label>
        <select id={backupTypeSelectId} name="type" defaultValue="DATABASE" className="rounded-lg border border-white/[0.08] bg-slate-950 px-3 py-2 text-sm text-slate-100">
          <option value="DATABASE">{t("common.databaseBackup")}</option>
          <option value="FILES">{t("common.fileBackup")}</option>
          <option value="FULL">{t("common.fullBackup")}</option>
        </select>
      </div>
      <div className="grid gap-1.5">
        <label htmlFor={backupNoteInputId} className="text-xs font-medium text-[var(--text-secondary)]">备份备注</label>
        <input id={backupNoteInputId} name="note" maxLength={500} placeholder="例如：升级前备份" className="rounded-lg border border-white/[0.08] bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 light:placeholder:text-slate-500" />
      </div>
      <button disabled={pending} className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60">
        {pending ? "执行中" : "创建并执行"}
      </button>
      {state.error && <p className="md:col-span-3 text-xs text-rose-300">{state.error}</p>}
    </form>
  );
}
