"use client";
import { useActionState, useId } from "react";
import { SubmitButton } from "@/components/submit-button";
import { useDialogFocus } from "@/lib/a11y/use-dialog-focus";
import { PasswordField } from "@/components/password-field";
import {
  changePasswordAction,
  type AccountPasswordActionState,
} from "@/app/account/password/actions";
import { useI18n } from "@/lib/i18n/use-locale";
const initialState: AccountPasswordActionState = {};
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
  const titleId = useId();
  const descriptionId = useId();
  const { t } = useI18n();
  const dialogRef = useDialogFocus<HTMLDivElement>({ open: open, onClose: onClose });

  const closeModalLabel = t("common.closeChangePasswordModal");
  const changePasswordDescription = t("common.changePasswordDescription");
  const titleText = t("common.editPassword");
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {" "}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />{" "}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="relative z-10 w-full max-w-md mx-4 rounded-3xl border border-[var(--border)] bg-[var(--modal-bg)] p-6 shadow-2xl"
      >
        {" "}
        <div className="flex items-center justify-between mb-4">
          {" "}
          <h2
            id={titleId}
            className="text-xl font-semibold text-[var(--text-primary)]"
          >
            {titleText}
          </h2>{" "}
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)] light:hover:text-[var(--color-action-fg)] transition"
            aria-label={closeModalLabel}
          >
            {" "}
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              {" "}
              <path
                d="M4 4l10 10M14 4L4 14"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />{" "}
            </svg>{" "}
          </button>{" "}
        </div>{" "}
        <p
          id={descriptionId}
          className="mb-4 text-sm text-[var(--text-secondary)]"
        >
          {" "}
          {changePasswordDescription}{" "}
        </p>{" "}
        <form action={formAction} className="grid gap-4">
          {" "}
          <input
            type="text"
            name="username"
            autoComplete="username"
            className="hidden"
            tabIndex={-1}
            aria-hidden="true"
          />{" "}
          <PasswordField
            label={t("changePassword.currentPassword")}
            name="currentPassword"
            autoComplete="current-password"
            placeholder={t("changePassword.currentPasswordPlaceholder")}
            description={t("changePassword.currentPasswordDesc")}
          />{" "}
          <PasswordField
            label={t("changePassword.newPassword")}
            name="newPassword"
            autoComplete="new-password"
            placeholder={t("changePassword.newPasswordPlaceholder")}
            description={t("changePassword.newPasswordDesc")}
          />{" "}
          <PasswordField
            label={t("changePassword.confirmPassword")}
            name="confirmPassword"
            autoComplete="new-password"
            placeholder={t("changePassword.confirmPasswordPlaceholder")}
            description={t("changePassword.confirmPasswordDesc")}
          />{" "}
          {state.error ? (
            <div
              role="alert"
              data-tone="rose"
              className="rounded-2xl border border-[var(--danger-border)] px-4 py-3 text-sm text-[var(--danger)]"
            >
              {state.error}
            </div>
          ) : null}{" "}
          {state.success ? (
            <div
              role="status"
              aria-live="polite"
              data-tone="emerald"
              className="rounded-2xl border border-[var(--success-border)] px-4 py-3 text-sm text-[var(--success)]"
            >
              {state.success}
            </div>
          ) : null}{" "}
          <div className="flex justify-end gap-3 pt-2">
            {" "}
            <button
              type="button"
              onClick={onClose}
              className="rounded-2xl border border-[var(--border)] px-5 py-2.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] transition"
            >
              {" "}
              {t("common.cancel")}{" "}
            </button>{" "}
            <SubmitButton pendingLabel={t("changePassword.saving")}>
              {t("common.saveNewPassword")}
            </SubmitButton>{" "}
          </div>{" "}
        </form>{" "}
      </div>{" "}
    </div>
  );
}

