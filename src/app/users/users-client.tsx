"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useUrlQueryState } from "@/lib/hooks/use-url-query-state";
import { UserPermissionPanel } from "./user-permission-panel";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { EmptyState, ListPanel, ListRow, PageHeader, Toolbar } from "@/components/page-shell";
import { Pagination } from "@/components/pagination";
import { SkeletonList } from "@/components/skeleton";
import { toDateLocale } from "@/lib/i18n/locale-format";
import { useI18n } from "@/lib/i18n/use-locale";
import { useToast } from "@/components/toast-provider";
import {
  UsersCreateForm,
  UsersResetPasswordDialog,
  statusLabel,
  statusTone,
  type CreateUserFormState,
  type CustomerOption,
  type IdentityTemplateOption,
} from "./users-forms";
import { identityTemplateName } from "@/lib/auth/identity-templates";
import { getErrorMessage } from "@/lib/http/error-message";
import { ActionButton } from "@/components/action-button";
import { Plus } from "@/components/icons";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui-primitives";

type UserInfo = {
  id: string;
  username: string;
  displayName: string | null;
  status: string;
  mustChangePassword: boolean;
  createdAt: string;
  accountType: "admin" | "customer";
  customer: { id: string; name: string; deleted: boolean } | null;
  identityTemplate: IdentityTemplateOption | null;
};

const EMPTY_CREATE_FORM: CreateUserFormState = { username: "", displayName: "", password: "", accountType: "customer", teamId: "", identityTemplateId: "identity:viewer" };

/** Fixed page size for the users list (matches the API request below). */
const USER_PAGE_SIZE = 50;

export function UserManagementClient({ header, canManage = false, currentUserId = "" }: {
  /** Page header; rendered here so the create command sits in its actions. */
  header?: { eyebrow?: string; title: string; description?: string };
  canManage?: boolean;
  currentUserId?: string;
}) {
  const { t, locale } = useI18n();
	const { addToast } = useToast();
  const { state: urlState, setField: setUrlField } = useUrlQueryState({ page: "1" });
  const page = Math.max(1, Number.parseInt(urlState.page || "1", 10) || 1);
  const setPage = (value: number) => setUrlField("page", String(Math.max(1, value)));
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState<CreateUserFormState>(EMPTY_CREATE_FORM);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [templates, setTemplates] = useState<IdentityTemplateOption[]>([]);
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

  // Options for the create form: live customers and identity templates.
  useEffect(() => {
    if (!canManage) return;
    void Promise.all([
      csrfFetch<{ teams: CustomerOption[] }>("/api/teams"),
      csrfFetch<{ templates: IdentityTemplateOption[] }>("/api/identity-templates"),
    ]).then(([teamData, templateData]) => {
      setCustomers(teamData.teams);
      setTemplates(templateData.templates);
      setCreateForm((form) => form.teamId ? form : { ...form, teamId: teamData.teams[0]?.id ?? "" });
    }).catch(() => undefined);
  }, [canManage]);

  const handleCreate = async () => {
    setCreating(true);
		try {
			const { accountType, teamId, identityTemplateId, ...identity } = createForm;
			await csrfFetch("/api/users", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					...identity,
					account: accountType === "admin" ? { type: "admin" } : { type: "customer", teamId, identityTemplateId },
				}),
			});
			addToast("success", t("usersPage.success.created", { name: createForm.username }));
			setCreateForm({ ...EMPTY_CREATE_FORM, teamId: customers[0]?.id ?? "" });
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

  return (
    <div>
      {(() => {
        const createAction = canManage ? (
          <ActionButton
            variant={showCreateForm ? "secondary" : "primary"}
            icon={showCreateForm ? undefined : <Plus size={16} aria-hidden />}
            onClick={() => setShowCreateForm(!showCreateForm)}
          >
            {showCreateForm ? t("usersPage.action.cancel") : t("usersPage.action.create")}
          </ActionButton>
        ) : null;
        if (header) return <PageHeader eyebrow={header.eyebrow} title={header.title} description={header.description}>{createAction}</PageHeader>;
        return createAction ? <Toolbar className="justify-end">{createAction}</Toolbar> : null;
      })()}
      {showCreateForm && (
        <UsersCreateForm
          t={t}
          createForm={createForm}
          setCreateForm={setCreateForm}
          creating={creating}
          onSubmit={handleCreate}
          customers={customers}
          templates={templates}
        />
      )}

      <ListPanel
        title={t("usersPage.title2")}
        count={loading ? "…" : total || users.length}
        empty={
          loading ? (
            <div className="space-y-3 p-4" aria-busy="true" aria-live="polite">
              <span className="sr-only">{t("usersPage.loading")}</span>
              <SkeletonList count={4} />
            </div>
          ) : loadFailed ? (
            <EmptyState>{t("usersPage.loadFailedHint")}</EmptyState>
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
                    {user.accountType === "admin" ? (
                      <Badge tone="accent">{t("usersPerm.account.type.admin")}</Badge>
                    ) : user.customer ? (
                      <>
                        <Badge tone={user.customer.deleted ? "warning" : "neutral"}>
                          {user.customer.deleted ? t("usersPage.customerDeleted", { name: user.customer.name }) : user.customer.name}
                        </Badge>
                        {user.identityTemplate && <Badge tone="neutral">{identityTemplateName(user.identityTemplate, t)}</Badge>}
                      </>
                    ) : (
                      <Badge tone="warning">{t("usersPage.noCustomer")}</Badge>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  {canManage && user.id !== currentUserId && <ActionButton size="sm"
                    variant="outline"
                    onClick={() => setEditingPermissionsUser(user)}>{t("usersPage.action.permissions")}</ActionButton>}
                  {canManage ? (
                    <>
                      <ActionButton size="sm"
                        variant="warning"
                        onClick={() => { setResetPasswordUser(user); setResetPasswordValue(""); }}>
                        {t("usersPage.action.resetPassword")}
                      </ActionButton>
                      {user.status !== "DISABLED" ? (
                        user.id !== currentUserId && (
                          <ActionButton size="sm"
                            variant="danger"
                            onClick={() => handleToggleStatus(user.id, user.status, user.username)}
                            disabled={togglingUserId !== null}>
                            {t("usersPage.action.disable")}
                          </ActionButton>
                        )
                      ) : (
                        user.id !== currentUserId && (
                          <ActionButton size="sm"
                            variant="success"
                            onClick={() => handleToggleStatus(user.id, user.status, user.username)}
                            disabled={togglingUserId !== null}>
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
            <div className="border-t border-[var(--border-subtle)] px-4 py-2 sm:px-5">
              <Pagination page={page} pageSize={USER_PAGE_SIZE} totalItems={total} loading={loading} onPageChange={setPage} />
            </div>
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
