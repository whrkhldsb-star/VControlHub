"use client";

import { useActionState, useState } from "react";

import { SubmitButton } from "@/components/submit-button";
import { Notice } from "@/components/ui-primitives";
import { useI18n } from "@/lib/i18n/use-locale";
import { updateStorageNodeAction, type StorageActionState } from "./actions";
import { StorageNodeFields, type StorageNodeFieldValues } from "./storage-node-fields";

const initialState: StorageActionState = {};

type StorageNodeEditValue = StorageNodeFieldValues & { id: string; driver: string };

export function StorageNodeEditForm({ node, servers }: { node: StorageNodeEditValue; servers: Array<{ id: string; name: string; host: string }> }) {
  const { t } = useI18n();
  const [state, formAction] = useActionState(updateStorageNodeAction, initialState);
  const [driver, setDriver] = useState(node.driver);

  return (
    <form action={formAction} className="grid gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <input type="hidden" name="storageNodeId" value={node.id} />
      <h3 className="text-lg font-medium text-[var(--text-primary)]">{t("storagePage.form.editTitle")}</h3>
      <StorageNodeFields driver={driver} onDriverChange={setDriver} servers={servers} values={node} includeExplicitUncheckedDefault lockDefault={node.isDefault} />
      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
      {state.success ? <Notice tone="success">{state.success}</Notice> : null}
      <div className="flex justify-end"><SubmitButton pendingLabel={t("storagePage.form.submitPending")}>{t("storagePage.form.submitEdit")}</SubmitButton></div>
    </form>
  );
}
