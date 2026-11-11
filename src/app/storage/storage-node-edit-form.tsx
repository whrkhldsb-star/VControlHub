"use client";

import { useActionState, useState } from "react";

import { SubmitButton } from "@/components/submit-button";
import { Notice } from "@/components/ui-primitives";
import { usePreservedActionForm } from "@/lib/forms/use-preserved-action-form";
import { useI18n } from "@/lib/i18n/use-locale";
import { updateStorageNodeAction, type StorageActionState } from "./actions";
import { StorageNodeFields, type StorageNodeFieldValues } from "./storage-node-fields";

const initialState: StorageActionState = {};

type StorageNodeEditValue = StorageNodeFieldValues & { id: string; driver: string };

export function StorageNodeEditForm({ node, servers }: { node: StorageNodeEditValue; servers: Array<{ id: string; name: string; host: string }> }) {
  const { t } = useI18n();
  const [state, formAction] = useActionState(updateStorageNodeAction, initialState);
  // React clears the fields of a form whose action has answered, a refusal included: the fields kept in state
  // (driver, WebDAV address) stayed and everything else that had been typed was gone.
  const { formRef, captureBeforeSubmit } = usePreservedActionForm(state, Boolean(state.error));
  const [driver, setDriver] = useState(node.driver);

  return (
    <form ref={formRef} action={formAction} onSubmit={captureBeforeSubmit} data-card className="grid gap-4 p-5">
      <input type="hidden" name="storageNodeId" value={node.id} />
      <h3 className="ui-title-section">{t("storagePage.form.editTitle")}</h3>
      <StorageNodeFields driver={driver} onDriverChange={setDriver} servers={servers} values={node} includeExplicitUncheckedDefault lockDefault={node.isDefault} />
      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
      {state.success ? <Notice tone="success">{state.success}</Notice> : null}
      <div className="flex justify-end"><SubmitButton pendingLabel={t("storagePage.form.submitPending")}>{t("storagePage.form.submitEdit")}</SubmitButton></div>
    </form>
  );
}
