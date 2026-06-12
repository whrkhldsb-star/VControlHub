"use client";

import { useState, useEffect, useCallback } from "react";
import { UserPermissionPanel } from "./user-permission-panel";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { EmptyState } from "@/components/page-shell";

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

const ROLE_OPTIONS: { key: string; name: string; color: string }[] = [
  { key: "admin", name: "管理员", color: "rose" },
  { key: "operator", name: "运维", color: "amber" },
  { key: "storage_manager", name: "存储管理员", color: "emerald" },
  { key: "viewer", name: "观察者", color: "cyan" },
];

type Tone = "accent" | "success" | "warning" | "danger" | "neutral";

function roleBadgeTone(key: string): Tone {
  const found = ROLE_OPTIONS.find((r) => r.key === key);
  if (!found) return "neutral";
  const tones: Record<string, Tone> = {
    rose: "danger",
    amber: "warning",
    emerald: "success",
    cyan: "accent",
  };
  return tones[found.color] ?? "accent";
}

function statusTone(status: string): Tone {
  if (status === "ACTIVE") return "success";
  if (status === "DISABLED") return "danger";
  return "warning";
}

function statusLabel(status: string) {
  if (status === "ACTIVE") return "正常";
  if (status === "DISABLED") return "已禁用";
  if (status === "PENDING_PASSWORD_RESET") return "待改密";
  return status;
}

export function UserManagementClient({ canManage = false }: { canManage?: boolean }) {
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
			setMessage({ type: "error", text: messageFromError(err, "用户列表加载失败") });
		}
		finally { setLoading(false); }
	}, []);

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
			setMessage({ type: "success", text: `用户 ${createForm.username} 创建成功` });
			setCreateForm({ username: "", displayName: "", password: "", roleKeys: ["viewer"] });
			setShowCreateForm(false);
			fetchUsers();
		} catch (err) {
			setMessage({ type: "error", text: err instanceof Error ? err.message : "创建失败" });
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
      setMessage({ type: "success", text: `已${action === "enable" ? "启用" : "禁用"} ${username}` });
      await fetchUsers();
    } catch (err) {
      setMessage({
        type: "error",
        text: messageFromError(err, `${action === "enable" ? "启用" : "禁用"} ${username} 失败`),
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
        <h2 className="text-lg font-medium text-white">用户列表</h2>
        {canManage ? (
          <button
            type="button"
            onClick={() => setShowCreateForm(!showCreateForm)}
            data-tone="accent"
            className="rounded-full border px-4 py-2 text-sm transition"
          >
            {showCreateForm ? "取消" : "+ 创建用户"}
          </button>
        ) : null}
      </div>

      {/* Create form */}
      {showCreateForm && (
        <div className="mb-6 rounded-2xl border border-[var(--border)] bg-slate-900/60 light:bg-white/60 p-6 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm text-slate-400 mb-1">用户名 *</label>
              <input
                type="text"
                value={createForm.username}
                onChange={(e) => setCreateForm((p) => ({ ...p, username: e.target.value }))}
                className="w-full rounded-2xl border border-[var(--border)] bg-slate-950 light:bg-white px-4 py-2 text-sm text-white focus:border-cyan-400/50 focus:outline-none"
                placeholder="用户名"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">显示名称</label>
              <input
                type="text"
                value={createForm.displayName}
                onChange={(e) => setCreateForm((p) => ({ ...p, displayName: e.target.value }))}
                className="w-full rounded-2xl border border-[var(--border)] bg-slate-950 light:bg-white px-4 py-2 text-sm text-white focus:border-cyan-400/50 focus:outline-none"
                placeholder="可选"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm text-slate-400 mb-1">密码 *</label>
              <input
                type="password"
                value={createForm.password}
                onChange={(e) => setCreateForm((p) => ({ ...p, password: e.target.value }))}
                className="w-full rounded-2xl border border-[var(--border)] bg-slate-950 light:bg-white px-4 py-2 text-sm text-white focus:border-cyan-400/50 focus:outline-none"
                placeholder="至少6位"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-2">角色分配</label>
            <div className="flex flex-wrap gap-2">
              {ROLE_OPTIONS.map((role) => (
                <button
                  key={role.key}
                  type="button"
                  onClick={() => toggleRole(role.key)}
                  className={`rounded-full border px-3 py-1.5 text-xs transition ${
                    createForm.roleKeys.includes(role.key)
                      ? ""
                      : "border-white/10 bg-white/5 text-slate-500"
                  }`}
                  data-tone={createForm.roleKeys.includes(role.key) ? roleBadgeTone(role.key) : undefined}
                >
                  {role.name}
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
            {creating ? "创建中..." : "确认创建"}
          </button>
        </div>
      )}

      {/* User list */}
      <div className="overflow-hidden rounded-2xl border border-[var(--border)]">
        <div className="divide-y divide-white/5 bg-slate-950/40 light:bg-white/40">
          {loading ? (
            <EmptyState>加载中…</EmptyState>
          ) : loadFailed ? (
            <div className="px-4 py-10 text-sm text-slate-400">用户列表加载失败，请稍后重试。</div>
          ) : users.length === 0 ? (
            <EmptyState>暂无用户。</EmptyState>
          ) : (
            users.map((user) => (
              <div key={user.id} className="px-4 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <span className="text-white font-medium">{user.displayName ?? user.username}</span>
                    <span data-tone={statusTone(user.status)} className="rounded-full border px-2 py-0.5 text-[10px] font-medium">
                      {statusLabel(user.status)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                    <span>@{user.username}</span>
                    <span>·</span>
                    <span>{new Date(user.createdAt).toLocaleDateString("zh-CN")}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {user.roles.map((role) => (
                      <span key={role.key} data-tone={roleBadgeTone(role.key)} className="rounded-full border px-2 py-0.5 text-[10px] font-medium">
                        {role.name}
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
                        权限配置
                      </button>
                      {user.status !== "DISABLED" ? (
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(user.id, user.status, user.username)}
                          data-tone="danger"
                          className="rounded-full border px-3 py-1.5 text-xs transition"
                        >
                          禁用
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(user.id, user.status, user.username)}
                          data-tone="success"
                          className="rounded-full border px-3 py-1.5 text-xs transition"
                        >
                          启用
                        </button>
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-slate-500">只读</span>
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
