"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useUrlQueryState } from "@/lib/hooks/use-url-query-state";
import { UserPermissionPanel } from "./user-permission-panel";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { EmptyState, ListPanel, ListRow, Toolbar } from "@/components/page-shell";
import { Pagination } from "@/components/pagination";
import { toDateLocale } from "@/lib/i18n/locale-format";
import { useI18n } from "@/lib/i18n/use-locale";
import { useToast } from "@/components/toast-provider";
import {
  UsersCreateForm,
  UsersResetPasswordDialog,
  roleBadgeTone,
  statusLabel,
  statusTone,
  type CreateUserFormState,
} from "./users-forms";
import { getErrorMessage } from "@/lib/http/error-message";
import { ActionButton } from "@/components/action-button";
import { StatusBadge } from "@/components/status-badge";

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

/** Fixed page size for the users list (matches the API request below). */
const USER_PAGE_SIZE = 50;

export function UserManagementClient({ canManage = false, currentUserId = "" }: { canManage?: boolean; currentUserId?: string }) {
  const { t, locale } = useI18n();
	const { addToast } = useToast();
  const { state: urlState, setField: setUrlField } = useUrlQueryState({ page: "1" });
  const page = Math.max(1, Number.parseInt(urlState.page || "1", 10) || 1);
  const setPage = (value: number) => setUrlField("page", String(Math.max(1, value)));
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState<CreateUserFormState>({ username: "", displayName: "", password: "", roleKeys: ["viewer"] });
  const [creating, setCreating] = useState(false);
  const [editingPermissionsUser, setEditingPermissionsUser] = useState<UserInfo | null>(null);
	const [loadFailed, setLoadFailed] = useState(false);
	const fetchGenRef = useRef(0);

	const messageFromError = (err: unknown, fallback: string) => (getErrorMessage(err, fallback));

	const fetchUsers = useCallback(async () => {
		const gen = ++fetchGenRef.current;
		setLoadFailed(false);
		try {
			const data = await csrfFetch(`/api/users?page=${page}&pageSize=${USER_PAGE_SIZE}`) as { users?: UserInfo[]; total?: number } | UserInfo[];
			// Ignore out-of-order responses from rapid pagination.
			if (gen !== fetchGenRef.current) return;
			if (Array.isArray(data)) {
				setUsers(data);
				setTotal(data.length);
			} else {
				setUsers(data.users ?? []);
				setTotal(data.total ?? (data.users ?? []).length);
			}
		} catch (err) {
			if (gen !== fetchGenRef.current) return;
			setUsers([]);
			setLoadFailed(true);
			addToast("error", messageFromError(err, t("usersPage.error.loadFailed")) );
		}
		finally {
			if (gen === fetchGenRef.current) setLoading(false);
		}
	}, [t, page, addToast]);

	useEffect(() => {
		setLoading(true);
		void fetchUsers();
		return () => {
			// Invalidate in-flight list so unmount/page-change cannot apply stale state.
			fetchGenRef.current += 1;
		};
	}, [fetchUsers]);

  const handleCreate = async () => {
    setCreating(true);
		try {
			await csrfFetch("/api/users", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(createForm),
			});
			addToast("success", t("usersPage.success.created", { name: createForm.username }));
			setCreateForm({ username: "", displayName: "", password: "", roleKeys: ["viewer"] });
			setShowCreateForm(false);
			fetchUsers();
		} catch (err) {
			addToast("error", getErrorMessage(err, t("usersPage.error.createFailed")) );
		} finally {
			setCreating(false);
		}
  };

  const [togglingUserId, setTogglingUserId] = useState<string | null>(null);

  const handleToggleStatus = async (userId: string, currentStatus: string, username: string) => {
    if (togglingUserId) return;
    const action = currentStatus === "DISABLED" ? "enable" : "disable";
    setTogglingUserId(userId);
    try {
      await csrfFetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, action }),
      });
      const successKey = action === "enable" ? "usersPage.success.enabled" : "usersPage.success.disabled";
      addToast("success", t(successKey, { name: username }));
      await fetchUsers();
    } catch (err) {
      const errKey = action === "enable" ? "usersPage.error.enableFailed" : "usersPage.error.disableFailed";
      addToast("error", messageFromError(err, t(errKey, { name: username })));
    } finally {
      setTogglingUserId(null);
    }
  };

  const [resetPasswordUser, setResetPasswordUser] = useState<UserInfo | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [resetting, setResetting] = useState(false);

  const handleResetPassword = async () => {
    if (!resetPasswordUser || !resetPasswordValue) return;
    setResetting(true);
    try {
      await csrfFetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: resetPasswordUser.id, action: "reset_password", newPassword: resetPasswordValue }),
      });
      addToast("success", t("usersPage.success.passwordReset", { name: resetPasswordUser.username }));
      setResetPasswordUser(null);
      setResetPasswordValue("");
      // The reset flips status to PENDING_PASSWORD_RESET; without a refetch the
      // row keeps showing the stale status until the page is reloaded.
      await fetchUsers();
    } catch (err) {
      addToast("error", messageFromError(err, t("usersPage.error.resetFailed", { name: resetPasswordUser.username })));
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
      <Toolbar className="mb-5 justify-between">
        <h2 className="px-1 text-sm font-semibold text-[var(--text-primary)] sm:text-base">{t("usersPage.title2")}</h2>
        {canManage ? (
          <ActionButton variant="primary"
            onClick={() => setShowCreateForm(!showCreateForm)}
            data-primary
            className="px-4 py-2 text-sm"
          >
            {showCreateForm ? t("usersPage.action.cancel") : t("usersPage.action.create")}
          </ActionButton>
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
        count={loading ? "…" : total || users.length}
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
                    <StatusBadge tone={statusTone(user.status)}>
                      {statusLabel(user.status, t)}
                    </StatusBadge>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                    <span>@{user.username}</span>
                    <span>·</span>
                    <span>{new Date(user.createdAt).toLocaleDateString(toDateLocale(locale))}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {user.roles.map((role) => (
                      <StatusBadge key={role.key} tone={roleBadgeTone(role.key)}>
                        {t(`usersPage.role.${role.key}`)}
                      </StatusBadge>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  {canManage ? (
                    <>
                      <ActionButton
                        variant="outline"
                        onClick={() => setEditingPermissionsUser(user)}
                        className="!px-3 !py-1.5 !text-sm"
                      >
                        {t("usersPage.action.permissions")}
                      </ActionButton>
                      <ActionButton
                        variant="warning"
                        onClick={() => { setResetPasswordUser(user); setResetPasswordValue(""); }}
                        className="!px-3 !py-1.5 !text-sm"
                      >
                        {t("usersPage.action.resetPassword")}
                      </ActionButton>
                      {user.status !== "DISABLED" ? (
                        user.id !== currentUserId && (
                          <ActionButton
                            variant="danger"
                            onClick={() => handleToggleStatus(user.id, user.status, user.username)}
                            disabled={togglingUserId !== null}
                            className="!px-3 !py-1.5 !text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {t("usersPage.action.disable")}
                          </ActionButton>
                        )
                      ) : (
                        user.id !== currentUserId && (
                          <ActionButton
                            variant="success"
                            onClick={() => handleToggleStatus(user.id, user.status, user.username)}
                            disabled={togglingUserId !== null}
                            className="!px-3 !py-1.5 !text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {t("usersPage.action.enable")}
                          </ActionButton>
                        )
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-[var(--text-muted)]">{t("usersPage.action.readonly")}</span>
                  )}
                </div>
              </ListRow>
            ))}
      
          {!loading && !loadFailed && (
            <Pagination page={page} pageSize={USER_PAGE_SIZE} totalItems={total} loading={loading} onPageChange={setPage} />
          )}
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
