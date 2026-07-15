"use client";

import { SurfacePanel } from "@/components/page-shell";

export const ROLE_KEYS = ["admin", "operator", "storage_manager", "viewer"] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];
export type Tone = "accent" | "success" | "warning" | "danger" | "neutral";

export const ROLE_COLORS: Record<RoleKey, "danger" | "warning" | "success" | "accent"> = {
  admin: "danger",
  operator: "warning",
  storage_manager: "success",
  viewer: "accent",
};

export function roleBadgeTone(key: string): Tone {
  return (ROLE_COLORS as Record<string, Tone>)[key] ?? "accent";
}

export function statusTone(status: string): Tone {
  if (status === "ACTIVE") return "success";
  if (status === "DISABLED") return "danger";
  return "warning";
}

export function statusLabel(status: string, t: (k: string) => string) {
  if (status === "ACTIVE") return t("usersPage.status.active");
  if (status === "DISABLED") return t("usersPage.status.disabled");
  if (status === "PENDING_PASSWORD_RESET") return t("usersPage.status.pending");
  return status;
}

export type CreateUserFormState = {
  username: string;
  displayName: string;
  password: string;
  roleKeys: string[];
};

export function UsersCreateForm({
  t,
  createForm,
  setCreateForm,
  creating,
  onSubmit,
  onToggleRole,
}: {
  t: (k: string) => string;
  createForm: CreateUserFormState;
  setCreateForm: React.Dispatch<React.SetStateAction<CreateUserFormState>>;
  creating: boolean;
  onSubmit: () => void;
  onToggleRole: (roleKey: string) => void;
}) {
  return (
    <SurfacePanel className="mb-6" title={t("usersPage.action.create")}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm text-[var(--text-muted)]" htmlFor="createUserUsername">
            {t("usersPage.form.username")}
          </label>
          <input
            id="createUserUsername"
            type="text"
            value={createForm.username}
            onChange={(e) => setCreateForm((p) => ({ ...p, username: e.target.value }))}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-4 py-2.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent-border)] focus:outline-none"
            placeholder={t("usersPage.form.usernamePlaceholder")}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-[var(--text-muted)]" htmlFor="createUserDisplayName">
            {t("usersPage.form.displayName")}
          </label>
          <input
            id="createUserDisplayName"
            type="text"
            value={createForm.displayName}
            onChange={(e) => setCreateForm((p) => ({ ...p, displayName: e.target.value }))}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-4 py-2.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent-border)] focus:outline-none"
            placeholder={t("usersPage.form.displayNamePlaceholder")}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm text-[var(--text-muted)]" htmlFor="createUserPassword">
            {t("usersPage.form.password")}
          </label>
          <input
            id="createUserPassword"
            type="password"
            autoComplete="new-password"
            value={createForm.password}
            onChange={(e) => setCreateForm((p) => ({ ...p, password: e.target.value }))}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-4 py-2.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent-border)] focus:outline-none"
            placeholder={t("usersPage.form.passwordPlaceholder")}
          />
        </div>
      </div>
      <div>
        <label className="mb-2 block text-sm text-[var(--text-secondary)]">{t("usersPage.form.roles")}</label>
        <div className="flex flex-wrap gap-2">
          {ROLE_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => onToggleRole(key)}
              className={`rounded-full border px-3 py-1.5 text-xs transition ${
                createForm.roleKeys.includes(key)
                  ? ""
                  : "border-[var(--border)]/10 bg-[var(--surface)]/10 text-[var(--text-muted)]"
              }`}
              data-tone={createForm.roleKeys.includes(key) ? roleBadgeTone(key) : undefined}
            >
              {t(`usersPage.role.${key}`)}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={onSubmit}
        disabled={creating || !createForm.username || !createForm.password}
        data-tone="accent"
        className="rounded-lg border px-6 py-2 text-sm font-medium transition disabled:opacity-50"
      >
        {creating ? t("usersPage.action.creating") : t("usersPage.action.confirm")}
      </button>
    </SurfacePanel>
  );
}

export function UsersResetPasswordDialog({
  t,
  username,
  dialogRef,
  password,
  setPassword,
  resetting,
  onCancel,
  onConfirm,
}: {
  t: (k: string) => string;
  username: string;
  dialogRef: React.RefObject<HTMLDivElement | null>;
  password: string;
  setPassword: (value: string) => void;
  resetting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] px-4 backdrop-blur-sm"
      role="presentation"
      onClick={onCancel}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-password-title"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-[var(--warning-border)] bg-[var(--modal-bg)] p-6 shadow-lg"
      >
        <h2 id="reset-password-title" className="text-lg font-semibold text-[var(--text-primary)]">
          {t("usersPage.resetPassword.title").replace("{name}", username)}
        </h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">{t("usersPage.resetPassword.desc")}</p>
        <input
          type="password"
          autoComplete="new-password"
          aria-label={t("usersPage.form.passwordPlaceholder")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-4 w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-4 py-2.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent-border)] focus:outline-none"
          placeholder={t("usersPage.form.passwordPlaceholder")}
          autoFocus
        />
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
          >
            {t("usersPage.action.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={resetting || !password}
            data-tone="warning"
            className="rounded-xl border px-4 py-2 text-sm font-medium transition disabled:opacity-50"
          >
            {resetting ? t("usersPage.action.resetting") : t("usersPage.action.confirmReset")}
          </button>
        </div>
      </section>
    </div>
  );
}
