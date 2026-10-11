"use client";

import { SurfacePanel } from "@/components/page-shell";
import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";
import { ActionButton } from "@/components/action-button";
import { Dialog } from "@/components/ui/dialog";

import { Chip } from "@/components/ui-primitives";
import { identityTemplateName } from "@/lib/auth/identity-templates";
/** Subset of StatusBadge's StatusTone that the users page uses. */
export type Tone = "accent" | "success" | "warning" | "danger" | "neutral";

export function statusTone(status: string): Tone {
  if (status === "ACTIVE") return "success";
  if (status === "DISABLED") return "danger";
  return "warning";
}

export function statusLabel(status: string, t: (k: string, vars?: Record<string, string | number>) => string) {
  if (status === "ACTIVE") return t("usersPage.status.active");
  if (status === "DISABLED") return t("usersPage.status.disabled");
  if (status === "PENDING_PASSWORD_RESET") return t("usersPage.status.pending");
  return status;
}

export type CreateUserFormState = {
  username: string;
  displayName: string;
  password: string;
  accountType: "customer" | "admin";
  teamId: string;
  identityTemplateId: string;
};

export type CustomerOption = { id: string; name: string };
export type IdentityTemplateOption = { id: string; name: string; isBuiltin: boolean };

export function UsersCreateForm({
  t,
  createForm,
  setCreateForm,
  creating,
  onSubmit,
  customers,
  templates,
}: {
  t: (k: string, vars?: Record<string, string | number>) => string;
  createForm: CreateUserFormState;
  setCreateForm: React.Dispatch<React.SetStateAction<CreateUserFormState>>;
  creating: boolean;
  onSubmit: () => void;
  customers: CustomerOption[];
  templates: IdentityTemplateOption[];
}) {
  return (
    <SurfacePanel className="mb-6" title={t("usersPage.action.create")}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="ui-label mb-1 block" htmlFor="createUserUsername">
            {t("usersPage.form.username")}
          </label>
          <input
            id="createUserUsername"
            type="text"
            value={createForm.username}
            onChange={(e) => setCreateForm((p) => ({ ...p, username: e.target.value }))}
            data-input className={cn(UI_INPUT)}
            placeholder={t("usersPage.form.usernamePlaceholder")}
          />
        </div>
        <div>
          <label className="ui-label mb-1 block" htmlFor="createUserDisplayName">
            {t("usersPage.form.displayName")}
          </label>
          <input
            id="createUserDisplayName"
            type="text"
            value={createForm.displayName}
            onChange={(e) => setCreateForm((p) => ({ ...p, displayName: e.target.value }))}
            data-input className={cn(UI_INPUT)}
            placeholder={t("usersPage.form.displayNamePlaceholder")}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="ui-label mb-1 block" htmlFor="createUserPassword">
            {t("usersPage.form.password")}
          </label>
          <input
            id="createUserPassword"
            type="password"
            autoComplete="new-password"
            value={createForm.password}
            onChange={(e) => setCreateForm((p) => ({ ...p, password: e.target.value }))}
            data-input className={cn(UI_INPUT)}
            placeholder={t("usersPage.form.passwordPlaceholder")}
          />
        </div>
      </div>
      <div>
        <span className="ui-label mb-2 block">{t("usersPage.form.accountType")}</span>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("usersPage.form.accountType")}>
          {(["customer", "admin"] as const).map((type) => (
            <Chip key={type} selected={createForm.accountType === type} onClick={() => setCreateForm((p) => ({ ...p, accountType: type }))}>
              {t(`usersPerm.account.type.${type}`)}
            </Chip>
          ))}
        </div>
      </div>
      {createForm.accountType === "customer" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="ui-label mb-1 block" htmlFor="createUserCustomer">{t("usersPerm.account.customer")}</label>
            <select id="createUserCustomer" value={createForm.teamId} onChange={(e) => setCreateForm((p) => ({ ...p, teamId: e.target.value }))} className={cn(UI_INPUT)}>
              {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
            </select>
          </div>
          <div>
            <label className="ui-label mb-1 block" htmlFor="createUserTemplate">{t("usersPerm.account.template")}</label>
            <select id="createUserTemplate" value={createForm.identityTemplateId} onChange={(e) => setCreateForm((p) => ({ ...p, identityTemplateId: e.target.value }))} className={cn(UI_INPUT)}>
              {templates.map((template) => <option key={template.id} value={template.id}>{identityTemplateName(template, t)}</option>)}
            </select>
          </div>
        </div>
      )}
      <ActionButton
        variant="primary"
        onClick={onSubmit}
        disabled={creating || !createForm.username || !createForm.password || (createForm.accountType === "customer" && !createForm.teamId)}>
        {creating ? t("usersPage.action.creating") : t("usersPage.action.confirm")}
      </ActionButton>
    </SurfacePanel>
  );
}

export function UsersResetPasswordDialog({
  t,
  username,
  password,
  setPassword,
  resetting,
  onCancel,
  onConfirm,
}: {
  t: (k: string, vars?: Record<string, string | number>) => string;
  username: string;
  password: string;
  setPassword: (value: string) => void;
  resetting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open
      onClose={onCancel}
      busy={resetting}
      title={t("usersPage.resetPassword.title", { name: username })}
      description={t("usersPage.resetPassword.desc")}
      footer={<>
        <ActionButton variant="secondary" onClick={onCancel} disabled={resetting}>
          {t("usersPage.action.cancel")}
        </ActionButton>
        <ActionButton variant="warning" onClick={onConfirm} loading={resetting} disabled={!password}>
          {resetting ? t("usersPage.action.resetting") : t("usersPage.action.confirmReset")}
        </ActionButton>
      </>}
    >
      <input
        type="password"
        autoComplete="new-password"
        aria-label={t("usersPage.form.passwordPlaceholder")}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && password && !resetting) onConfirm(); }}
        className={UI_INPUT}
        placeholder={t("usersPage.form.passwordPlaceholder")}
        autoFocus
      />
    </Dialog>
  );
}
