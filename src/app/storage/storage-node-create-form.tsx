"use client";

import { useActionState, useState } from "react";

import { SubmitButton } from "@/components/submit-button";
import { Notice } from "@/components/ui-primitives";
import { usePreservedActionForm } from "@/lib/forms/use-preserved-action-form";
import { useI18n } from "@/lib/i18n/use-locale";
import { createStorageNodeAction, type StorageActionState } from "./actions";
import { StorageNodeFields } from "./storage-node-fields";

const initialState: StorageActionState = {};

export function StorageNodeCreateForm({ servers }: { servers: Array<{ id: string; name: string; host: string }> }) {
  const { t } = useI18n();
  const [state, formAction] = useActionState(createStorageNodeAction, initialState);
  // React clears the fields of a form whose action has answered, a refusal included: the fields kept in state
  // (driver, WebDAV address) stayed and everything else that had been typed was gone.
  const { formRef, captureBeforeSubmit } = usePreservedActionForm(state, Boolean(state.error));
  const [driver, setDriver] = useState("LOCAL");

  return (
    <form ref={formRef} action={formAction} onSubmit={captureBeforeSubmit} data-card className="grid gap-4 p-6">
      <div>
        <h2 className="ui-title-section">{t("storagePage.form.createTitle")}</h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">{t("storagePage.form.createDescription")}</p>
      </div>
      <StorageNodeFields driver={driver} onDriverChange={setDriver} servers={servers} />
      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
      {state.success ? <Notice tone="success">{state.success}</Notice> : null}
      <div className="flex justify-end"><SubmitButton pendingLabel={t("storagePage.form.submitPending")}>{t("storagePage.form.submitCreate")}</SubmitButton></div>
    </form>
  );
}
