"use client";

import { useState, useEffect, useCallback } from "react";
import { UserPermissionPanel } from "./user-permission-panel";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { EmptyState, ListPanel, ListRow, Toolbar } from "@/components/page-shell";
import { toDateLocale } from "@/lib/i18n/locale-format";
import { useI18n } from "@/lib/i18n/use-locale";
import { useDialogFocus } from "@/lib/a11y/use-dialog-focus";
import {
  UsersCreateForm,
  UsersResetPasswordDialog,
  roleBadgeTone,
  statusLabel,
  statusTone,
  type CreateUserFormState,
} from "./users-forms";

type RoleInfo = { key: string; name: string };
type UserInfo = {
  id: string;
  username: string;
  displayName: string | null;
  status: string;
  mustChangePassword: boolean;
  createdAt: string;
  roles: RoleInfo[];
};

export function UserManagementClient({ canManage = false, currentUserId = "" }: { canManage?: boolean; currentUserId?: string }) {
  const { t, locale } = useI18n();
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState<CreateUserFormState>({ username: "", displayName: "", password: "", roleKeys: ["viewer"] });
  const [creating, setCreating] = useState(false);
  const [editingPermissionsUser, setEditingPermissionsUser] = useState<UserInfo | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
	const [loadFailed, setLoadFailed] = useState(false);

	const messageFromError = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

	const fetchUsers = useCallback(async () => {
		setLoadFailed(false);
		try {
			const data = await csrfFetch("/api/users") as { users?: UserInfo[] } | UserInfo[];
			setUsers(Array.isArray(data) ? data : (data.users ?? []));
		} catch (err) {
			setUsers([]);
			setLoadFailed(true);
			setMessage({ type: "error", text: messageFromError(err, t("usersPage.error.loadFailed")) });
		}
		finally { setLoading(false); }
	}, [t]);

	/* eslint-disable react-hooks/set-state-in-effect */
	useEffect(() => {
		fetchUsers();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	/* eslint-enable react-hooks/set-state-in-effect */

  const handleCreate = async () => {
    setCreating(true);
	setMessage(null);
		try {
			await csrfFetch("/api/users", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(createForm),
			});
			setMessage({ type: "success", text: t("usersPage.success.created").replace("{name}", createForm.username) });
			setCreateForm({ username: "", displayName: "", password: "", roleKeys: ["viewer"] });
			setShowCreateForm(false);
			fetchUsers();
		} catch (err) {
			setMessage({ type: "error", text: err instanceof Error ? err.message : t("usersPage.error.createFailed") });
		} finally {
			setCreating(false);
		}
  };

  const handleToggleStatus = async (userId: string, currentStatus: string, username: string) => {
    const action = currentStatus === "DISABLED" ? "enable" : "disable";
    setMessage(null);
    try {
      await csrfFetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, action }),
      });
      const successKey = action === "enable" ? "usersPage.success.enabled" : "usersPage.success.disabled";
      setMessage({ type: "success", text: t(successKey).replace("{name}", username) });
      await fetchUsers();
    } catch (err) {
      const errKey = action === "enable" ? "usersPage.error.enableFailed" : "usersPage.error.disableFailed";
      setMessage({
        type: "error",
        text: messageFromError(err, t(errKey).replace("{name}", username)),
      });
    }
  };

  const [resetPasswordUser, setResetPasswordUser] = useState<UserInfo | null>(null);
  const dialogRef = useDialogFocus<HTMLDivElement>({ open: resetPasswordUser !== null, onClose: () => setResetPasswordUser(null) });
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [resetting, setResetting] = useState(false);

  const handleResetPassword = async () => {
    if (!resetPasswordUser || !resetPasswordValue) return;
    setResetting(true);
    setMessage(null);
    try {
      await csrfFetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: resetPasswordUser.id, action: "reset_password", newPassword: resetPasswordValue }),
      });
      setMessage({ type: "success", text: t("usersPage.success.passwordReset").replace("{name}", resetPasswordUser.username) });
      setResetPasswordUser(null);
      setResetPasswordValue("");
    } catch (err) {
      setMessage({ type: "error", text: messageFromError(err, t("usersPage.error.resetFailed").replace("{name}", resetPasswordUser.username)) });
    } finally {
      setResetting(false);
    }
  };

  const toggleRole = (roleKey: string) => {
    setCreateForm((prev) => ({
      ...prev,
      roleKeys: prev.roleKeys.includes(roleKey)
        ? prev.roleKeys.filter((k) => k !== roleKey)
        : [...prev.roleKeys, roleKey],
    }));
  };

  return (
    <div>
      {/* Message */}
      {message && (
        <div
          role={message.type === "error" ? "alert" : "status"}
          className={`mb-4 rounded-2xl border px-4 py-3 text-sm ${
          message.type === "success"
            ? "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]"
            : "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger)]"
        }`}>
          {message.text}
          <button type="button" onClick={() => setMessage(null)} aria-label={t("common.close")} className="ml-3 text-current/50 hover:text-current">✕</button>
        </div>
      )}

      <Toolbar className="mb-5 justify-between">
        <h2 className="px-1 text-sm font-semibold text-[var(--text-primary)] sm:text-base">{t("usersPage.title2")}</h2>
        {canManage ? (
          <button
            type="button"
            onClick={() => setShowCreateForm(!showCreateForm)}
            data-primary
            className="px-4 py-2 text-sm" data-action-button data-variant="primary"
          >
            {showCreateForm ? t("usersPage.action.cancel") : t("usersPage.action.create")}
          </button>
        ) : null}
      </Toolbar>
      {showCreateForm && (
        <UsersCreateForm
          t={t}
          createForm={createForm}
          setCreateForm={setCreateForm}
          creating={creating}
          onSubmit={handleCreate}
          onToggleRole={toggleRole}
        />
      )}

      <ListPanel
        title={t("usersPage.title2")}
        count={loading ? "…" : users.length}
        empty={
          loading ? (
            <EmptyState>{t("usersPage.loading")}</EmptyState>
          ) : loadFailed ? (
            <EmptyState variant="boxed">{t("usersPage.loadFailedHint")}</EmptyState>
          ) : users.length === 0 ? (
            <EmptyState>{t("usersPage.empty")}</EmptyState>
          ) : undefined
        }
      >
            {!loading && !loadFailed && users.map((user) => (
              <ListRow key={user.id} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <span className="text-[var(--text-primary)] font-medium">{user.displayName ?? user.username}</span>
                    <span data-tone={statusTone(user.status)} className="rounded-lg border px-2 py-0.5 text-[10px] font-medium">
                      {statusLabel(user.status, t)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                    <span>@{user.username}</span>
                    <span>·</span>
                    <span>{new Date(user.createdAt).toLocaleDateString(toDateLocale(locale))}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {user.roles.map((role) => (
                      <span key={role.key} data-tone={roleBadgeTone(role.key)} className="rounded-lg border px-2 py-0.5 text-[10px] font-medium">
                        {t(`usersPage.role.${role.key}`)}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  {canManage ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setEditingPermissionsUser(user)}
                        data-tone="accent"
                        className="rounded-lg border px-3 py-1.5 text-xs transition"
                      >
                        {t("usersPage.action.permissions")}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setResetPasswordUser(user); setResetPasswordValue(""); }}
                        data-tone="warning"
                        className="rounded-lg border px-3 py-1.5 text-xs transition"
                      >
                        {t("usersPage.action.resetPassword")}
                      </button>
                      {user.status !== "DISABLED" ? (
                        user.id !== currentUserId && (
                          <button
                            type="button"
                            onClick={() => handleToggleStatus(user.id, user.status, user.username)}
                            data-tone="danger"
                            className="rounded-lg border px-3 py-1.5 text-xs transition"
                          >
                            {t("usersPage.action.disable")}
                          </button>
                        )
                      ) : (
                        user.id !== currentUserId && (
                          <button
                            type="button"
                            onClick={() => handleToggleStatus(user.id, user.status, user.username)}
                            data-tone="success"
                            className="rounded-lg border px-3 py-1.5 text-xs transition"
                          >
                            {t("usersPage.action.enable")}
                          </button>
                        )
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-[var(--text-muted)]">{t("usersPage.action.readonly")}</span>
                  )}
                </div>
              </ListRow>
            ))}
      </ListPanel>
      {editingPermissionsUser && (
        <UserPermissionPanel
          userId={editingPermissionsUser.id}
          username={editingPermissionsUser.username}
          onClose={() => setEditingPermissionsUser(null)}
          onSaved={fetchUsers}
        />
      )}
      {resetPasswordUser && (
        <UsersResetPasswordDialog
          t={t}
          username={resetPasswordUser.username}
          dialogRef={dialogRef}
          password={resetPasswordValue}
          setPassword={setResetPasswordValue}
          resetting={resetting}
          onCancel={() => setResetPasswordUser(null)}
          onConfirm={handleResetPassword}
        />
      )}
    </div>
  );
}
