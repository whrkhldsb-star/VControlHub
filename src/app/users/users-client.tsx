"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useUrlQueryState } from "@/lib/hooks/use-url-query-state";
import { UserPermissionPanel } from "./user-permission-panel";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { EmptyState, ListPanel, ListRow, PageHeader, Toolbar } from "@/components/page-shell";
import { Pagination } from "@/components/pagination";
import { SkeletonList } from "@/components/skeleton";
import { formatDate } from "@/lib/datetime/format";
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
  type PasswordRules,
} from "./users-forms";
import { identityTemplateName } from "@/lib/auth/identity-templates";
import { getErrorMessage } from "@/lib/http/error-message";
import { ActionButton } from "@/components/action-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Plus, Search } from "@/components/icons";
import { StatusBadge } from "@/components/status-badge";
import { Badge, Notice } from "@/components/ui-primitives";
import { replaceBrowserUrl } from "@/lib/browser-history";
import { useUnsavedChangesGuard } from "@/lib/forms/use-unsaved-changes-guard";
import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";
import { isImeComposition } from "@/lib/ui/keyboard";

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
/** The search box asks the server after a pause in typing, as the audit log does; Enter asks at once. */
const SEARCH_DEBOUNCE_MS = 300;

function sameCreateForm(a: CreateUserFormState, b: CreateUserFormState): boolean {
  return a.username === b.username && a.displayName === b.displayName && a.password === b.password
    && a.accountType === b.accountType && a.teamId === b.teamId && a.identityTemplateId === b.identityTemplateId;
}

/** The address without the deep link's own parameters, so that a reload or Back does not open the form again. */
function withoutCreateLink(href: string): string {
  const url = new URL(href);
  url.searchParams.delete("create");
  url.searchParams.delete("teamId");
  return `${url.pathname}${url.search}${url.hash}`;
}

export function UserManagementClient({ header, canManage = false, currentUserId = "", passwordRules }: {
  /** Page header; rendered here so the create command sits in its actions. */
  header?: { eyebrow?: string; title: string; description?: string };
  canManage?: boolean;
  currentUserId?: string;
  /** The password policy in force, so that the fields can say what a password has to have. */
  passwordRules?: PasswordRules;
}) {
  const { t, locale } = useI18n();
  const { addToast } = useToast();
  const { state: urlState, setField: setUrlField, patch: patchUrl } = useUrlQueryState({ page: "1", q: "" });
  const page = Math.max(1, Number.parseInt(urlState.page || "1", 10) || 1);
  const setPage = (value: number) => setUrlField("page", String(Math.max(1, value)));
  // The box stays controlled; the query the list reads lags behind it while typing.
  const searchQuery = urlState.q || "";
  const setSearchQuery = (value: string) => patchUrl({ q: value, page: "1" });
  const [debouncedSearch, setDebouncedSearch] = useState(searchQuery);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchQuery), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);
  const search = debouncedSearch.trim();
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState<CreateUserFormState>(EMPTY_CREATE_FORM);
  // What the form holds before anything is typed: the first customer filled in for the person, or the one a link
  // named. Unsaved input is measured against this, not against empty fields.
  const [createBaseline, setCreateBaseline] = useState<CreateUserFormState>(EMPTY_CREATE_FORM);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [optionsLoaded, setOptionsLoaded] = useState(false);
  const [templates, setTemplates] = useState<IdentityTemplateOption[]>([]);
  const [creating, setCreating] = useState(false);
  const [editingPermissionsUser, setEditingPermissionsUser] = useState<UserInfo | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // The directory has shown an account: from then on the search box stays, also while a search reloads the list.
  const [seenAccounts, setSeenAccounts] = useState(false);
  // Why the customers and identity templates of the create form could not be read.
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const fetchGenRef = useRef(0);
  // The translator for effects that must not run again when the language changes.
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; }, [t]);

  const messageFromError = (err: unknown, fallback: string) => (getErrorMessage(err, fallback));

  const fetchUsers = useCallback(async () => {
    const gen = ++fetchGenRef.current;
    setLoadFailed(false);
    try {
      const query = search ? `&q=${encodeURIComponent(search)}` : "";
      const data = await csrfFetch(`/api/users?page=${page}&pageSize=${USER_PAGE_SIZE}${query}`) as { users?: UserInfo[]; total?: number } | UserInfo[];
      // Ignore out-of-order responses from rapid pagination.
      if (gen !== fetchGenRef.current) return;
      const list = Array.isArray(data) ? data : data.users ?? [];
      setUsers(list);
      setTotal(Array.isArray(data) ? data.length : data.total ?? list.length);
      if (list.length > 0) setSeenAccounts(true);
    } catch (err) {
      if (gen !== fetchGenRef.current) return;
      setUsers([]);
      setLoadFailed(true);
      addToast("error", messageFromError(err, t("usersPage.error.loadFailed")) );
    }
    finally {
      if (gen === fetchGenRef.current) setLoading(false);
    }
  }, [t, page, search, addToast]);

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
      setOptionsLoaded(true);
      const firstCustomer = teamData.teams[0]?.id ?? "";
      setCreateForm((form) => form.teamId ? form : { ...form, teamId: firstCustomer });
      setCreateBaseline((form) => form.teamId ? form : { ...form, teamId: firstCustomer });
      setOptionsError(null);
    }).catch((err: unknown) => {
      // Said in the form. In silence it left an empty list of customers and a button that stayed disabled.
      setOptionsError(getErrorMessage(err, tRef.current("usersPage.error.optionsFailed")));
      setOptionsLoaded(true);
    });
  }, [canManage]);

  // A link that asks for the form (`/users?create=1&teamId=…`: the next step after a new customer, the command
  // palette) opens it, also on a page already open. The customer it names is chosen once the customers are known,
  // and only if it is one of them; an account that may not create users only loses the parameters.
  const searchParams = useSearchParams();
  const wantsCreate = searchParams?.get("create") === "1";
  const linkedTeamId = searchParams?.get("teamId") ?? null;
  const [pendingLinkTeamId, setPendingLinkTeamId] = useState<string | null>(null);
  useEffect(() => {
    if (!wantsCreate) return;
    replaceBrowserUrl(withoutCreateLink(window.location.href));
    if (!canManage) return;
    setShowCreateForm(true);
    setPendingLinkTeamId(linkedTeamId);
  }, [wantsCreate, linkedTeamId, canManage]);
  useEffect(() => {
    if (pendingLinkTeamId === null || !optionsLoaded) return;
    setPendingLinkTeamId(null);
    // Only a customer this account may choose, and never over what was already typed into the form.
    if (!customers.some((customer) => customer.id === pendingLinkTeamId)) return;
    if (!sameCreateForm(createForm, createBaseline)) return;
    const choose = (form: CreateUserFormState): CreateUserFormState => ({ ...form, accountType: "customer", teamId: pendingLinkTeamId });
    setCreateForm(choose(createForm));
    setCreateBaseline(choose(createBaseline));
  }, [pendingLinkTeamId, optionsLoaded, customers, createForm, createBaseline]);

  // The form stays editable while a create is in flight; its success must
  // not wipe another user typed meanwhile.
  const latestCreateForm = useRef(createForm);
  useEffect(() => {
    latestCreateForm.current = createForm;
  }, [createForm]);

  const createDirty = showCreateForm && !sameCreateForm(createForm, createBaseline);
  const closeCreateForm = useCallback(() => {
    setShowCreateForm(false);
    setCreateForm(createBaseline);
  }, [createBaseline]);
  const { requestDiscard, discardDialog } = useUnsavedChangesGuard({ dirty: createDirty, onDiscard: closeCreateForm });

  // Something to search once the directory has shown an account, and for as long as a search is typed.
  const showSearch = seenAccounts || searchQuery !== "";

  const handleCreate = async () => {
    const submitted = createForm;
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
      addToast("success", t("usersPage.success.created", { name: submitted.username }));
      if (latestCreateForm.current === submitted) {
        const fresh = { ...EMPTY_CREATE_FORM, teamId: customers[0]?.id ?? "" };
        setCreateForm(fresh);
        setCreateBaseline(fresh);
        setShowCreateForm(false);
      }
      fetchUsers();
    } catch (err) {
      addToast("error", getErrorMessage(err, t("usersPage.error.createFailed")) );
    } finally {
      setCreating(false);
    }
  };

  const [togglingUserId, setTogglingUserId] = useState<string | null>(null);
  // Disabling signs the account out everywhere: it is asked first, and a refusal is shown in that dialog.
  const [disableTarget, setDisableTarget] = useState<UserInfo | null>(null);
  const [disableError, setDisableError] = useState<string | null>(null);

  const handleToggleStatus = async (userId: string, currentStatus: string, username: string) => {
    if (togglingUserId) return;
    const action = currentStatus === "DISABLED" ? "enable" : "disable";
    setTogglingUserId(userId);
    setDisableError(null);
    try {
      await csrfFetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, action }),
      });
      const successKey = action === "enable" ? "usersPage.success.enabled" : "usersPage.success.disabled";
      addToast("success", t(successKey, { name: username }));
      setDisableTarget(null);
      await fetchUsers();
    } catch (err) {
      const errKey = action === "enable" ? "usersPage.error.enableFailed" : "usersPage.error.disableFailed";
      const message = messageFromError(err, t(errKey, { name: username }));
      if (action === "disable") setDisableError(message);
      else addToast("error", message);
    } finally {
      setTogglingUserId(null);
    }
  };

  const [resetPasswordUser, setResetPasswordUser] = useState<UserInfo | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const handleResetPassword = async () => {
    if (!resetPasswordUser || !resetPasswordValue) return;
    setResetting(true);
    setResetError(null);
    try {
      await csrfFetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: resetPasswordUser.id, action: "reset_password", newPassword: resetPasswordValue }),
      });
      addToast("success", t("usersPage.success.passwordReset", { name: resetPasswordUser.username }));
      setResetPasswordUser(null);
      setResetPasswordValue("");
      // The reset sets mustChangePassword; without a refetch the row keeps
      // showing the stale badge until the page is reloaded.
      await fetchUsers();
    } catch (err) {
      // In the dialog the password was typed in, which stays open to correct it.
      setResetError(messageFromError(err, t("usersPage.error.resetFailed", { name: resetPasswordUser.username })));
    } finally {
      setResetting(false);
    }
  };

  return (
    <div>
      {(() => {
        // The command opens the form under the header and steps aside while it is open; the form's own Cancel
        // closes it, asking first when something was typed (this button used to discard it in silence).
        const createAction = canManage && !showCreateForm ? (
          <ActionButton variant="primary" icon={<Plus size={16} aria-hidden />} onClick={() => setShowCreateForm(true)}>
            {t("usersPage.action.create")}
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
          optionsError={optionsError}
          optionsLoaded={optionsLoaded}
          passwordRules={passwordRules}
          onCancel={requestDiscard}
        />
      )}
      {discardDialog}

      <ListPanel
        title={t("usersPage.title2")}
        count={loading ? "…" : total || users.length}
        actions={showSearch ? (
          <div className="relative w-full sm:w-64">
            <Search size={14} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="search"
              value={searchQuery}
              maxLength={100}
              aria-label={t("usersPage.search.label")}
              placeholder={t("usersPage.search.placeholder")}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                // Enter asks at once; the Enter that confirms an input method's candidate is part of the typing.
                if (event.key !== "Enter" || isImeComposition(event)) return;
                event.preventDefault();
                if (debouncedSearch !== searchQuery) setDebouncedSearch(searchQuery);
                else { setLoading(true); void fetchUsers(); }
              }}
              className={cn(UI_INPUT, "pl-9")}
            />
          </div>
        ) : undefined}
        empty={
          loading ? (
            <div className="space-y-3 p-4" aria-busy="true" aria-live="polite">
              <span className="sr-only">{t("usersPage.loading")}</span>
              <SkeletonList count={4} />
            </div>
          ) : loadFailed ? (
            <div className="p-4">
              <Notice tone="danger" action={{ label: t("common.retry"), onClick: () => { setLoading(true); void fetchUsers(); } }}>
                {t("usersPage.loadFailedHint")}
              </Notice>
            </div>
          ) : users.length === 0 ? (
            search ? (
              <EmptyState
                title={t("common.noMatches")}
                text={t("usersPage.search.noMatches", { query: search })}
                action={<ActionButton size="sm" variant="secondary" onClick={() => { setSearchQuery(""); setDebouncedSearch(""); }}>{t("common.clearSearch")}</ActionButton>}
              />
            ) : (
              <EmptyState
                title={t("usersPage.emptyTitle")}
                text={canManage ? t("usersPage.emptyHint") : undefined}
                action={canManage && !showCreateForm ? (
                  <ActionButton size="sm" variant="primary" icon={<Plus size={14} aria-hidden />} onClick={() => setShowCreateForm(true)}>
                    {t("usersPage.action.create")}
                  </ActionButton>
                ) : undefined}
              />
            )
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
                    {user.mustChangePassword && user.status === "ACTIVE" ? <StatusBadge tone="warning">{t("usersPage.status.mustChange")}</StatusBadge> : null}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                    <span>@{user.username}</span>
                    <span>·</span>
                    <span>{formatDate(user.createdAt, locale)}</span>
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
                        onClick={() => { setResetPasswordUser(user); setResetPasswordValue(""); setResetError(null); }}>
                        {t("usersPage.action.resetPassword")}
                      </ActionButton>
                      {user.status !== "DISABLED" ? (
                        user.id !== currentUserId && (
                          <ActionButton size="sm"
                            variant="danger"
                            onClick={() => { setDisableError(null); setDisableTarget(user); }}
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
          setPassword={(value) => { setResetPasswordValue(value); setResetError(null); }}
          error={resetError}
          passwordRules={passwordRules}
          resetting={resetting}
          onCancel={() => setResetPasswordUser(null)}
          onConfirm={handleResetPassword}
        />
      )}
      <ConfirmDialog
        open={disableTarget !== null}
        title={t("usersPage.disable.title")}
        description={t("usersPage.disable.confirm", { name: disableTarget?.username ?? "" })}
        cancelLabel={t("usersPage.action.cancel")}
        confirmLabel={t("usersPage.action.disable")}
        busy={togglingUserId !== null}
        error={disableError}
        onCancel={() => { if (!togglingUserId) setDisableTarget(null); }}
        onConfirm={() => { if (disableTarget) void handleToggleStatus(disableTarget.id, disableTarget.status, disableTarget.username); }}
        closeOnBackdrop={false}
      />
    </div>
  );
}
