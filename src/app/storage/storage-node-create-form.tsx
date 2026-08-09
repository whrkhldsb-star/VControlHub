"use client";

import { useActionState, useState } from "react";

import { SubmitButton } from "@/components/submit-button";
import { Notice } from "@/components/ui-primitives";
import { useI18n } from "@/lib/i18n/use-locale";
import { createStorageNodeAction, type StorageActionState } from "./actions";
import { StorageNodeFields } from "./storage-node-fields";

const initialState: StorageActionState = {};

export function StorageNodeCreateForm({ servers }: { servers: Array<{ id: string; name: string; host: string }> }) {
  const { t } = useI18n();
  const [state, formAction] = useActionState(createStorageNodeAction, initialState);
  const [driver, setDriver] = useState("LOCAL");

  return (
    <form action={formAction} className="grid gap-4 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <div>
        <h2 className="text-xl font-semibold text-[var(--text-primary)]">{t("storagePage.form.createTitle")}</h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">{t("storagePage.form.createDescription")}</p>
      </div>
      <StorageNodeFields driver={driver} onDriverChange={setDriver} servers={servers} />
      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
      {state.success ? <Notice tone="success">{state.success}</Notice> : null}
      <div className="flex justify-end"><SubmitButton pendingLabel={t("storagePage.form.submitPending")}>{t("storagePage.form.submitCreate")}</SubmitButton></div>
    </form>
  );
}
