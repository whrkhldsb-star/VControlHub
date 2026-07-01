"use client";

import { useState, useEffect, useCallback } from "react";
import { UserPermissionPanel } from "./user-permission-panel";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { EmptyState } from "@/components/page-shell";
import { useI18n } from "@/lib/i18n/use-locale";

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

const ROLE_KEYS = ["admin", "operator", "storage_manager", "viewer"] as const;
type RoleKey = (typeof ROLE_KEYS)[number];

type Tone = "accent" | "success" | "warning" | "danger" | "neutral";

const ROLE_COLORS: Record<RoleKey, "danger" | "warning" | "success" | "accent"> = {
  admin: "danger",
  operator: "warning",
  storage_manager: "success",
  viewer: "accent",
};

function roleBadgeTone(key: string): Tone {
  return (ROLE_COLORS as Record<string, Tone>)[key] ?? "accent";
}

function statusTone(status: string): Tone {
  if (status === "ACTIVE") return "success";
  if (status === "DISABLED") return "danger";
  return "warning";
}

function statusLabel(status: string, t: (k: string) => string) {
  if (status === "ACTIVE") return t("usersPage.status.active");
  if (status === "DISABLED") return t("usersPage.status.disabled");
  if (status === "PENDING_PASSWORD_RESET") return t("usersPage.status.pending");
  return status;
}

export function UserManagementClient({ canManage = false }: { canManage?: boolean }) {
  const { t, locale } = useI18n();
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState({ username: "", displayName: "", password: "", roleKeys: ["viewer"] });
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
          <button type="button" onClick={() => setMessage(null)} className="ml-3 text-current/50 hover:text-current">✕</button>
        </div>
      )}

      {/* Create button */}
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-medium text-[var(--text-primary)]">{t("usersPage.title2")}</h2>
        {canManage ? (
          <button
            type="button"
            onClick={() => setShowCreateForm(!showCreateForm)}
            data-tone="accent"
            className="rounded-full border px-4 py-2 text-sm transition"
          >
            {showCreateForm ? t("usersPage.action.cancel") : t("usersPage.action.create")}
          </button>
        ) : null}
      </div>

      {/* Create form */}
      {showCreateForm && (
        <div className="mb-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm text-[var(--text-muted)] mb-1" htmlFor="createUserUsername">{t("usersPage.form.username")}</label>
              <input
                id="createUserUsername"
                type="text"
                value={createForm.username}
                onChange={(e) => setCreateForm((p) => ({ ...p, username: e.target.value }))}
                className="w-full rounded-2xl border border-[var(--border)] bg-[var(--input-bg)] px-4 py-2 text-sm text-[var(--text-primary)] focus:border-cyan-400/50 focus:outline-none"
                placeholder={t("usersPage.form.usernamePlaceholder")}
              />
            </div>
            <div>
              <label className="block text-sm text-[var(--text-muted)] mb-1" htmlFor="createUserDisplayName">{t("usersPage.form.displayName")}</label>
              <input
                id="createUserDisplayName"
                type="text"
                value={createForm.displayName}
                onChange={(e) => setCreateForm((p) => ({ ...p, displayName: e.target.value }))}
                className="w-full rounded-2xl border border-[var(--border)] bg-[var(--input-bg)] px-4 py-2 text-sm text-[var(--text-primary)] focus:border-cyan-400/50 focus:outline-none"
                placeholder={t("usersPage.form.displayNamePlaceholder")}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm text-[var(--text-muted)] mb-1" htmlFor="createUserPassword">{t("usersPage.form.password")}</label>
              <input
                id="createUserPassword"
                type="password"
                value={createForm.password}
                onChange={(e) => setCreateForm((p) => ({ ...p, password: e.target.value }))}
                className="w-full rounded-2xl border border-[var(--border)] bg-[var(--input-bg)] px-4 py-2 text-sm text-[var(--text-primary)] focus:border-cyan-400/50 focus:outline-none"
                placeholder={t("usersPage.form.passwordPlaceholder")}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm text-[var(--text-secondary)] mb-2">{t("usersPage.form.roles")}</label>
            <div className="flex flex-wrap gap-2">
              {ROLE_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleRole(key)}
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
            onClick={handleCreate}
            disabled={creating || !createForm.username || !createForm.password}
            data-tone="accent"
            className="rounded-full border px-6 py-2 text-sm font-medium transition disabled:opacity-50"
          >
            {creating ? t("usersPage.action.creating") : t("usersPage.action.confirm")}
          </button>
        </div>
      )}

      {/* User list */}
      <div className="overflow-hidden rounded-2xl border border-[var(--border)]">
        <div className="divide-y divide-[var(--border)] bg-[var(--surface-subtle)]">
          {loading ? (
            <EmptyState>{t("usersPage.loading")}</EmptyState>
          ) : loadFailed ? (
            <div className="px-4 py-10 text-sm text-[var(--text-secondary)]">{t("usersPage.loadFailedHint")}</div>
          ) : users.length === 0 ? (
            <EmptyState>{t("usersPage.empty")}</EmptyState>
          ) : (
            users.map((user) => (
              <div key={user.id} className="px-4 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <span className="text-[var(--text-primary)] font-medium">{user.displayName ?? user.username}</span>
                    <span data-tone={statusTone(user.status)} className="rounded-full border px-2 py-0.5 text-[10px] font-medium">
                      {statusLabel(user.status, t)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                    <span>@{user.username}</span>
                    <span>·</span>
                    <span>{new Date(user.createdAt).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US")}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {user.roles.map((role) => (
                      <span key={role.key} data-tone={roleBadgeTone(role.key)} className="rounded-full border px-2 py-0.5 text-[10px] font-medium">
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
                        className="rounded-full border px-3 py-1.5 text-xs transition"
                      >
                        {t("usersPage.action.permissions")}
                      </button>
                      {user.status !== "DISABLED" ? (
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(user.id, user.status, user.username)}
                          data-tone="danger"
                          className="rounded-full border px-3 py-1.5 text-xs transition"
                        >
                          {t("usersPage.action.disable")}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(user.id, user.status, user.username)}
                          data-tone="success"
                          className="rounded-full border px-3 py-1.5 text-xs transition"
                        >
                          {t("usersPage.action.enable")}
                        </button>
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-[var(--text-muted)]">{t("usersPage.action.readonly")}</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      {editingPermissionsUser && (
        <UserPermissionPanel
          userId={editingPermissionsUser.id}
          username={editingPermissionsUser.username}
          onClose={() => setEditingPermissionsUser(null)}
          onSaved={fetchUsers}
        />
      )}
    </div>
  );
}
