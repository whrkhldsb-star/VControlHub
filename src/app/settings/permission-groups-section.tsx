"use client";

import { useEffect, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { PERMISSIONS } from "@/lib/auth/rbac";
import { getErrorMessage } from "@/lib/http/error-message";
import { useI18n } from "@/lib/i18n/use-locale";
import { ActionButton } from "@/components/action-button";
import { Notice } from "@/components/ui-primitives";
import { UI_INPUT } from "@/lib/ui/classes";

type Group = {
  id: string;
  name: string;
  description: string | null;
  roleKeys: string[];
  permissions: string[];
  storageAccess: unknown[];
  serverAccess: unknown[];
  isBuiltin: boolean;
};

type Member = {
  role: string;
  accessRole: string;
  permissionTemplateId?: string | null;
  user: { id: string; username: string; displayName: string | null };
};

const GROUP_ROLE_KEYS = ["viewer", "operator", "storage_manager"] as const;
const PLATFORM_ONLY = new Set(["team:manage", "user:manage", "role:manage", "backup:create", "backup:read", "backup:restore", "announcement:manage"]);

export function PermissionGroupsSection({ teamId, members, canManage, onMemberChanged }: {
  teamId: string;
  members: Member[];
  canManage: boolean;
  onMemberChanged: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [name, setName] = useState("");
  const [roleKeys, setRoleKeys] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [showAllMembers, setShowAllMembers] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let cancelled = false;
    csrfFetch<{ templates: Group[] }>("/api/role-templates")
      .then((data) => { if (!cancelled) setGroups((data.templates ?? []).filter((group) =>
        group.isBuiltin || ((group.serverAccess?.length ?? 0) === 0 && (group.storageAccess?.length ?? 0) === 0)
      )); })
      .catch((cause) => { if (!cancelled) setError(getErrorMessage(cause, t("settingsTeam.groups.loadFailed"))); });
    return () => { cancelled = true; };
    // The selected workspace is the only fetch dependency; form edits must not be replaced.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  const selected = groups.find((group) => group.id === selectedId);
  function chooseGroup(id: string) {
    const group = groups.find((item) => item.id === id);
    setSelectedId(id);
    setName(group?.name ?? "");
    setRoleKeys(group?.roleKeys ?? []);
    setPermissions(group?.permissions ?? []);
    setError("");
    setSuccess("");
  }

  async function saveGroup() {
    if (!name.trim() || !canManage) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      const updating = selected && !selected.isBuiltin;
      const data = await csrfFetch<{ template: Group }>(updating ? `/api/role-templates/${encodeURIComponent(selected.id)}` : "/api/role-templates", {
        method: updating ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(), roleKeys, permissions,
          storageAccess: updating ? selected.storageAccess : [],
          serverAccess: updating ? selected.serverAccess : [],
        }),
      });
      setGroups((current) => updating
        ? current.map((item) => item.id === data.template.id ? data.template : item)
        : [...current, data.template]);
      setSelectedId(data.template.id);
      setName(data.template.name);
      setRoleKeys(data.template.roleKeys);
      setPermissions(data.template.permissions);
      setSuccess(t("settingsTeam.groups.saved"));
    } catch (cause) {
      setError(getErrorMessage(cause, t("settingsTeam.groups.saveFailed")));
    } finally { setBusy(false); }
  }

  async function deleteGroup() {
    if (!selected || selected.isBuiltin || !canManage || !window.confirm(t("settingsTeam.groups.confirmDelete"))) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      await csrfFetch(`/api/role-templates/${encodeURIComponent(selected.id)}`, { method: "DELETE" });
      setGroups((current) => current.filter((item) => item.id !== selected.id));
      chooseGroup("");
      await onMemberChanged();
      setSuccess(t("settingsTeam.groups.deleted"));
    } catch (cause) {
      setError(getErrorMessage(cause, t("settingsTeam.groups.deleteFailed")));
    } finally { setBusy(false); }
  }

  async function assignGroup(member: Member, groupId: string) {
    if (!canManage || member.role === "owner") return;
    setBusy(true); setError(""); setSuccess("");
    try {
      await csrfFetch(`/api/teams/${encodeURIComponent(teamId)}/members`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: member.user.username,
          role: member.role,
          accessRole: member.accessRole,
          permissionTemplateId: groupId || null,
        }),
      });
      await onMemberChanged();
      setSuccess(t("settingsTeam.groups.assigned"));
    } catch (cause) {
      setError(getErrorMessage(cause, t("settingsTeam.groups.assignFailed")));
    } finally { setBusy(false); }
  }

  return <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4">
    <h3 className="font-semibold text-[var(--text-primary)]">{t("settingsTeam.groups.title")}</h3>
    <p className="mt-1 text-xs text-[var(--text-muted)]">{t("settingsTeam.groups.hint")}</p>
    {error && <Notice tone="danger" className="mt-3">{error}</Notice>}
    {success && <Notice tone="success" className="mt-3">{success}</Notice>}
    {canManage && <div className="mt-4 space-y-3">
      <div className="flex flex-wrap gap-2">
        <select aria-label={t("settingsTeam.groups.select")} value={selectedId} onChange={(event) => chooseGroup(event.target.value)} className={UI_INPUT}>
          <option value="">{t("settingsTeam.groups.new")}</option>
          {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
        </select>
        <input aria-label={t("settingsTeam.groups.name")} placeholder={t("settingsTeam.groups.name")} value={name} onChange={(event) => setName(event.target.value)} className={UI_INPUT} maxLength={120} />
      </div>
      <div className="flex flex-wrap gap-3">
        {GROUP_ROLE_KEYS.map((key) => <label key={key} className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <input type="checkbox" checked={roleKeys.includes(key)} onChange={() => setRoleKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])} />
          {t(`settingsTeam.accessRole.${key}`)}
        </label>)}
      </div>
      <div className="grid max-h-72 gap-2 overflow-y-auto rounded-xl border border-[var(--border)] p-3 sm:grid-cols-3">
        {PERMISSIONS.filter((key) => !PLATFORM_ONLY.has(key)).map((key) => <label key={key} className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <input type="checkbox" checked={permissions.includes(key)} onChange={() => setPermissions((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])} />
          <span>{key}</span>
        </label>)}
      </div>
      <div className="flex gap-2">
        <ActionButton variant="primary" disabled={busy || !name.trim() || selected?.isBuiltin} onClick={saveGroup}>{selected && !selected.isBuiltin ? t("settingsTeam.groups.update") : t("settingsTeam.groups.create")}</ActionButton>
        {selected && !selected.isBuiltin && <ActionButton variant="danger" disabled={busy} onClick={deleteGroup}>{t("settingsTeam.groups.delete")}</ActionButton>}
      </div>
    </div>}
    <div className="mt-4 space-y-2">
      {members.filter((member) => member.role !== "owner").slice(0, showAllMembers ? undefined : 10).map((member) => <div key={member.user.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-[var(--text-secondary)]">@{member.user.username}</span>
        <select aria-label={`${member.user.username} ${t("settingsTeam.groups.select")}`} disabled={!canManage || busy} value={member.permissionTemplateId ?? ""} onChange={(event) => void assignGroup(member, event.target.value)} className={UI_INPUT}>
          <option value="">{t("settingsTeam.groups.noGroup")}</option>
          {groups.filter((group) => !group.isBuiltin).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
        </select>
      </div>)}
      {members.filter((member) => member.role !== "owner").length > 10 && !showAllMembers && <button type="button" className="text-xs text-[var(--accent)]" onClick={() => setShowAllMembers(true)}>{t("settingsTeam.groups.showAll")}</button>}
    </div>
  </section>;
}
