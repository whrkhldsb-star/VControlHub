"use client";
import { useActionState, useEffect, useState } from "react";
import { ActionButton } from "@/components/action-button";
import { SubmitButton } from "@/components/submit-button";
import { Dialog } from "@/components/ui/dialog";
import { PasswordField } from "@/components/password-field";
import {
  changePasswordAction,
  type AccountPasswordActionState,
} from "@/app/account/password/actions";
import { useI18n } from "@/lib/i18n/use-locale";
import { Notice } from "@/components/ui-primitives";
const initialState: AccountPasswordActionState = {};
const POST_SUCCESS_CLOSE_DELAY_MS = 1200;
export function ChangePasswordModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [state, formAction] = useActionState(
    changePasswordAction,
    initialState,
  );
  const { t } = useI18n();
  const [formKey, setFormKey] = useState(0);

  // Close after a short success flash so password fields are not left filled in an open modal.
  useEffect(() => {
    if (!open || !state.success) return;
    const timer = setTimeout(() => {
      setFormKey((value) => value + 1);
      onClose();
    }, POST_SUCCESS_CLOSE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [open, state.success, onClose]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("common.editPassword")}
      description={t("common.changePasswordDescription")}
      closeLabel={t("common.closeChangePasswordModal")}
    >
        <form key={formKey} action={formAction} className="grid gap-4">
          <input
            type="text"
            name="username"
            autoComplete="username"
            className="hidden"
            tabIndex={-1}
            aria-hidden="true"
          />
          <PasswordField
            label={t("changePassword.currentPassword")}
            name="currentPassword"
            autoComplete="current-password"
            placeholder={t("changePassword.currentPasswordPlaceholder")}
            description={t("changePassword.currentPasswordDesc")}
          />
          <PasswordField
            label={t("changePassword.newPassword")}
            name="newPassword"
            autoComplete="new-password"
            placeholder={t("changePassword.newPasswordPlaceholder")}
            description={t("changePassword.newPasswordDesc")}
          />
          <PasswordField
            label={t("changePassword.confirmPassword")}
            name="confirmPassword"
            autoComplete="new-password"
            placeholder={t("changePassword.confirmPasswordPlaceholder")}
            description={t("changePassword.confirmPasswordDesc")}
          />
          {state.error ? (
            <Notice tone="danger">{state.error}</Notice>
          ) : null}
          {state.success ? <Notice tone="success">{state.success}</Notice> : null}
          <div className="flex justify-end gap-2 pt-1">
            <ActionButton
              type="button"
              variant="secondary"
              onClick={onClose}>
              {t("common.cancel")}
            </ActionButton>
            <SubmitButton pendingLabel={t("changePassword.saving")}>
              {t("common.saveNewPassword")}
            </SubmitButton>
          </div>
        </form>
    </Dialog>
  );
}

