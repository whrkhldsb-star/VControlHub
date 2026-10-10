"use client";

import { useEffect, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { WORKSPACE_POLICY_PERMISSIONS } from "@/lib/auth/tenant-permissions";
import { groupPermissionsByDomain, permissionGroupName, permissionLabelKey } from "@/lib/auth/permission-labels";
import { DEFAULT_ROLE_PERMISSIONS, type RoleKey } from "@/lib/auth/rbac";
import { getErrorMessage } from "@/lib/http/error-message";
import { useI18n } from "@/lib/i18n/use-locale";
import { ActionButton } from "@/components/action-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
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
  kind: "POLICY_GROUP";
  isBuiltin: boolean;
};

type Member = {
  role: string;
  accessRole: string;
  permissionTemplateId?: string | null;
  user: { id: string; username: string; displayName: string | null };
};

const GROUP_ROLE_KEYS = ["viewer", "operator", "storage_manager"] as const;
const PERMISSION_DOMAINS = groupPermissionsByDomain(WORKSPACE_POLICY_PERMISSIONS);

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
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    csrfFetch<{ templates: Group[] }>("/api/role-templates?kind=POLICY_GROUP")
      .then((data) => { if (!cancelled) setGroups(data.templates ?? []); })
      .catch((cause) => { if (!cancelled) setError(getErrorMessage(cause, t("settingsTeam.groups.loadFailed"))); });
    return () => { cancelled = true; };
    // The selected workspace is the only fetch dependency; form edits must not be replaced.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  const selected = groups.find((group) => group.id === selectedId);
  const effectivePermissions = new Set([
    ...permissions,
    ...roleKeys.flatMap((key) => DEFAULT_ROLE_PERMISSIONS[key as RoleKey] ?? []),
  ]);

  function togglePermission(key: string) {
    if (effectivePermissions.has(key)) {
      // Detach presets into an exact list before removing a permission they
      // contributed. The saved group then matches every visible checkbox.
      setPermissions(Array.from(effectivePermissions).filter((permission) => permission !== key));
      setRoleKeys([]);
      return;
    }
    setPermissions((current) => [...current, key]);
  }
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
      const data = await csrfFetch<{ template: Group }>(selected ? `/api/role-templates/${encodeURIComponent(selected.id)}` : "/api/role-templates", {
        method: selected ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "POLICY_GROUP",
          name: name.trim(), roleKeys, permissions,
          storageAccess: [],
          serverAccess: [],
        }),
      });
      setGroups((current) => selected
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
    setConfirmingDelete(false);
    if (!selected || !canManage) return;
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
    if (!canManage || member.role !== "member") return;
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

  return <section data-inset className="p-4">
    <h3 className="ui-title-group">{t("settingsTeam.groups.title")}</h3>
    <p className="mt-1 text-xs text-[var(--text-muted)]">{t("settingsTeam.groups.hint")}</p>
    {error && <Notice tone="danger" className="mt-3">{error}</Notice>}
    {success && <Notice tone="success" className="mt-3">{success}</Notice>}
    {canManage && <div className="mt-4 space-y-3">
      <div className="flex flex-wrap gap-2">
        <select aria-label={t("settingsTeam.groups.select")} value={selectedId} onChange={(event) => chooseGroup(event.target.value)} className={UI_INPUT}>
          <option value="">{t("settingsTeam.groups.new")}</option>
          {groups.map((group) => <option key={group.id} value={group.id}>{permissionGroupName(group, t)}</option>)}
        </select>
        <input aria-label={t("settingsTeam.groups.name")} placeholder={t("settingsTeam.groups.name")} value={name} onChange={(event) => setName(event.target.value)} className={UI_INPUT} maxLength={120} />
      </div>
      <div className="flex flex-wrap gap-3">
        {GROUP_ROLE_KEYS.map((key) => <label key={key} className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <input type="checkbox" checked={roleKeys.includes(key)} onChange={() => setRoleKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])} />
          {t(`settingsTeam.accessRole.${key}`)}
        </label>)}
      </div>
      <p className="text-xs text-[var(--text-muted)]">{t("settingsTeam.groups.rolePresetHint")}</p>
      <div data-inset className="max-h-96 space-y-3 overflow-y-auto p-3">
        {PERMISSION_DOMAINS.map((group) => <fieldset key={group.domain} className="min-w-0">
          <legend className="ui-title-caption mb-1.5">{t(group.labelKey)}</legend>
          <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {group.permissions.map((key) => <label key={key} className="flex items-start gap-2 text-sm text-[var(--text-secondary)]" title={key}>
              <input type="checkbox" className="mt-1" checked={effectivePermissions.has(key)} onChange={() => togglePermission(key)} />
              <span className="min-w-0">
                {t(permissionLabelKey(key))}
                <span className="block font-mono text-[11px] text-[var(--text-muted)]">{key}</span>
              </span>
            </label>)}
          </div>
        </fieldset>)}
      </div>
      <div className="flex gap-2">
        <ActionButton variant="primary" disabled={busy || !name.trim()} onClick={saveGroup}>{selected ? t("settingsTeam.groups.update") : t("settingsTeam.groups.create")}</ActionButton>
        {selected && <ActionButton variant="danger" disabled={busy} onClick={() => setConfirmingDelete(true)}>{t("settingsTeam.groups.delete")}</ActionButton>}
      </div>
    </div>}
    <div className="mt-4 space-y-2">
      {members.filter((member) => member.role === "member").slice(0, showAllMembers ? undefined : 10).map((member) => <div key={member.user.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-[var(--text-secondary)]">@{member.user.username}</span>
        <select aria-label={`${member.user.username} ${t("settingsTeam.groups.select")}`} disabled={!canManage || busy} value={member.permissionTemplateId ?? ""} onChange={(event) => void assignGroup(member, event.target.value)} className={UI_INPUT}>
          <option value="">{t("settingsTeam.groups.noGroup")}</option>
          {groups.map((group) => <option key={group.id} value={group.id}>{permissionGroupName(group, t)}</option>)}
        </select>
      </div>)}
      {members.filter((member) => member.role === "member").length > 10 && !showAllMembers && <ActionButton size="xs" variant="ghost" onClick={() => setShowAllMembers(true)}>{t("settingsTeam.groups.showAll")}</ActionButton>}
    </div>
    <ConfirmDialog
      open={confirmingDelete}
      title={t("settingsTeam.groups.delete")}
      description={t("settingsTeam.groups.confirmDelete")}
      cancelLabel={t("common.cancel")}
      confirmLabel={t("settingsTeam.groups.delete")}
      busy={busy}
      onCancel={() => setConfirmingDelete(false)}
      onConfirm={() => void deleteGroup()}
    />
  </section>;
}
