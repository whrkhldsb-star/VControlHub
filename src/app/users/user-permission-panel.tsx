"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { formatBytes as formatBytesShared } from "@/lib/format/bytes";
import { EmptyState } from "@/components/page-shell";
import { Chip, InlineLoading, Notice } from "@/components/ui-primitives";
import { useI18n } from "@/lib/i18n/use-locale";
import { Dialog } from "@/components/ui/dialog";
import { getErrorMessage } from "@/lib/http/error-message";
import { ActionButton } from "@/components/action-button";
import { getStorageDriverLabel } from "@/lib/i18n/domain-labels";
import { Plus } from "@/components/icons";
import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";

type RoleInfo = { key: string; name: string; description?: string | null };
type PermissionInfo = { key: string; name: string; description?: string | null };
type StorageNodeInfo = { id: string; name: string; driver: string; basePath: string };
type ServerInfo = { id: string; name: string; operatingSystem: string; teamId: string | null };
type ServerGrant = {
  serverId: string;
  canRead: boolean;
  canConnect: boolean;
  canManage: boolean;
  canFileRead: boolean;
  canFileWrite: boolean;
  canFileDelete: boolean;
};
type StorageGrant = {
  id?: string;
  storageNodeId: string;
  pathPrefix: string;
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  quotaBytes: string | null;
  maxFileBytes: string | null;
  usedBytes?: string;
  storageNode?: StorageNodeInfo;
};

type PermissionsPayload = {
  user: {
    id: string;
    username: string;
    displayName: string | null;
    roles: RoleInfo[];
    effectivePermissions: string[];
    resourceAccessBypassed: boolean;
    /** Fine-grained custom role only (not base role grants). */
    directPermissionKeys?: string[];
    storageAccess: StorageGrant[];
    serverAccess?: ServerGrant[];
  };
  roles: RoleInfo[];
  permissions: PermissionInfo[];
  storageNodes: StorageNodeInfo[];
  servers?: ServerInfo[];
};

type RoleTemplate = {
  id: string;
  name: string;
  description: string | null;
  roleKeys: string[];
  permissions: string[];
  storageAccess: StorageGrant[];
  serverAccess?: ServerGrant[];
  kind: "ACCOUNT_TEMPLATE";
  /** Built-in templates are read-only: the API refuses PATCH/DELETE on them. */
  isBuiltin: boolean;
};

type Props = {
  userId: string;
  username: string;
  onClose: () => void;
  onSaved: () => void;
  resourceOnly?: boolean;
};

function formatBytes(value: string | null | undefined, t: (k: string, vars?: Record<string, string | number>) => string) {
  if (!value) return t("usersPerm.bytes.unlimited");
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return t("usersPerm.bytes.unlimited");
  return formatBytesShared(bytes);
}

function toBytes(value: string): { ok: true; value: string | null } | { ok: false } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  if (/^\d+$/.test(trimmed)) return { ok: true, value: trimmed };
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(kb|mb|gb|tb)$/i);
  if (!match) return { ok: false };
  const factor: Record<string, number> = { kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 };
  return {
    ok: true,
    value: String(Math.floor(Number(match[1]!) * factor[match[2]!.toLowerCase()]!)),
  };
}

function normalizeStorageGrants(grants: StorageGrant[]) {
  const normalized: Array<{
    storageNodeId: string;
    pathPrefix: string;
    canRead: boolean;
    canWrite: boolean;
    canDelete: boolean;
    quotaBytes: string | null;
    maxFileBytes: string | null;
  }> = [];
  for (const grant of grants) {
    const quota = toBytes(grant.quotaBytes ?? "");
    const maxFile = toBytes(grant.maxFileBytes ?? "");
    if (!quota.ok || !maxFile.ok) return null;
    normalized.push({
      storageNodeId: grant.storageNodeId,
      pathPrefix: grant.pathPrefix,
      canRead: grant.canRead,
      canWrite: grant.canWrite,
      canDelete: grant.canDelete,
      quotaBytes: quota.value,
      maxFileBytes: maxFile.value,
    });
  }
  return normalized;
}

export function UserPermissionPanel({ userId, username, onClose, onSaved, resourceOnly = false }: Props) {
  const { t } = useI18n();
  // Reach the translator from the load effect without putting `t` in its deps:
  // a locale switch must not refetch and overwrite unsaved admin edits.
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; }, [t]);
  const [payload, setPayload] = useState<PermissionsPayload | null>(null);
  const [roleKeys, setRoleKeys] = useState<string[]>([]);
  const [permissionKeys, setPermissionKeys] = useState<string[]>([]);
  const [grants, setGrants] = useState<StorageGrant[]>([]);
  const [serverGrants, setServerGrants] = useState<ServerGrant[]>([]);
  const [templateNameDraft, setTemplateNameDraft] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState<RoleTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [confirmingTemplateDelete, setConfirmingTemplateDelete] = useState(false);
  const [deletingTemplate, setDeletingTemplate] = useState(false);

  useEffect(() => {
    let cancelled = false;
csrfFetch(`/api/users/permissions?userId=${encodeURIComponent(userId)}`)
.then((data) => {
return data as PermissionsPayload;
})
      .then((data) => {
        if (cancelled) return;
        setPayload(data);
        setRoleKeys(data.user.roles.map((role) => role.key).filter((key) => !key.startsWith("user:") || !key.endsWith(":custom")));
        setPermissionKeys(data.user.directPermissionKeys ?? []);
        setGrants(data.user.storageAccess.map((grant) => ({ ...grant })));
        setServerGrants((data.user.serverAccess ?? []).map((grant) => ({ ...grant })));
      })
      .catch((error) => !cancelled && setMessage({ type: "error", text: getErrorMessage(error, tRef.current("usersPerm.error.loadFailed")) }))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    if (resourceOnly) return;
    csrfFetch("/api/role-templates?kind=ACCOUNT_TEMPLATE")
      .then((data) => setTemplates((data as { templates?: RoleTemplate[] }).templates ?? []))
      .catch(() => setTemplates([]));
  }, [resourceOnly]);

  const storageNodeMap = useMemo(() => new Map(payload?.storageNodes.map((node) => [node.id, node]) ?? []), [payload]);

  const toggle = (values: string[], value: string) => values.includes(value) ? values.filter((item) => item !== value) : [...values, value];

  const addGrant = () => {
    const firstNode = payload?.storageNodes[0];
    if (!firstNode) return;
    setGrants((current) => [...current, {
      storageNodeId: firstNode.id,
      pathPrefix: "",
      canRead: true,
      canWrite: false,
      canDelete: false,
      quotaBytes: null,
      maxFileBytes: null,
    }]);
  };

  const updateGrant = (index: number, patch: Partial<StorageGrant>) => {
    setGrants((current) => current.map((grant, i) => i === index ? { ...grant, ...patch } : grant));
  };

  const applyTemplate = () => {
    const template = templates.find((item) => item.id === selectedTemplateId);
    if (!template) return;
    setRoleKeys([...template.roleKeys]);
    setPermissionKeys([...template.permissions]);
    setGrants(template.storageAccess.map((grant) => ({ ...grant })));
    setServerGrants((template.serverAccess ?? []).map((grant) => ({ ...grant })));
    setMessage({ type: "success", text: t("usersPerm.template.applied") });
  };

  const selectedTemplate = templates.find((item) => item.id === selectedTemplateId) ?? null;

  const deleteSelectedTemplate = async () => {
    if (!selectedTemplate || selectedTemplate.isBuiltin) return;
    setDeletingTemplate(true);
    try {
      await csrfFetch(`/api/role-templates/${encodeURIComponent(selectedTemplate.id)}`, { method: "DELETE" });
      setTemplates((current) => current.filter((item) => item.id !== selectedTemplate.id));
      setSelectedTemplateId("");
      setConfirmingTemplateDelete(false);
      setMessage({ type: "success", text: t("usersPerm.template.deleted") });
    } catch (error) {
      setMessage({ type: "error", text: getErrorMessage(error, t("usersPerm.template.deleteFailed")) });
    } finally {
      setDeletingTemplate(false);
    }
  };

  const saveTemplate = async () => {
    const name = templateNameDraft.trim();
    if (!name) {
      setMessage({ type: "error", text: t("usersPerm.template.namePrompt") });
      return;
    }
    setSavingTemplate(true);
    try {
      const normalizedGrants = normalizeStorageGrants(grants);
      if (!normalizedGrants) {
        setMessage({ type: "error", text: t("usersPerm.error.invalidQuota") });
        return;
      }
      const data = await csrfFetch("/api/role-templates", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "ACCOUNT_TEMPLATE", name, roleKeys, permissions: permissionKeys, storageAccess: normalizedGrants, serverAccess: serverGrants }),
      }) as { template: RoleTemplate };
      setTemplates((current) => [...current, data.template].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedTemplateId(data.template.id);
      setTemplateNameDraft("");
      setMessage({ type: "success", text: t("usersPerm.template.saved") });
    } catch (error) {
      setMessage({ type: "error", text: getErrorMessage(error, t("usersPerm.error.saveFailed")) });
    } finally {
      setSavingTemplate(false);
    }
  };

  const updateSelectedTemplate = async () => {
    if (!selectedTemplate || selectedTemplate.isBuiltin) return;
    setSavingTemplate(true);
    try {
      const normalizedGrants = normalizeStorageGrants(grants);
      if (!normalizedGrants) {
        setMessage({ type: "error", text: t("usersPerm.error.invalidQuota") });
        return;
      }
      const data = await csrfFetch(`/api/role-templates/${encodeURIComponent(selectedTemplate.id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "ACCOUNT_TEMPLATE",
          name: selectedTemplate.name,
          description: selectedTemplate.description,
          roleKeys,
          permissions: permissionKeys,
          storageAccess: normalizedGrants,
          serverAccess: serverGrants,
        }),
      }) as { template: RoleTemplate };
      setTemplates((current) => current.map((item) => item.id === data.template.id ? data.template : item));
      setMessage({ type: "success", text: t("usersPerm.template.updated") });
    } catch (error) {
      setMessage({ type: "error", text: getErrorMessage(error, t("usersPerm.error.saveFailed")) });
    } finally {
      setSavingTemplate(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);

    const normalizedGrants = normalizeStorageGrants(grants);
    if (!normalizedGrants) {
      setMessage({ type: "error", text: t("usersPerm.error.invalidQuota") });
      setSaving(false);
      return;
    }

    try {
      const includeResourceAccess = !payload?.user.resourceAccessBypassed && !roleKeys.includes("admin");
      await csrfFetch("/api/users/permissions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          ...(resourceOnly ? {} : { roleKeys, permissionKeys }),
          ...(includeResourceAccess ? {
            storageAccess: normalizedGrants,
            storageAccessScopeIds: (payload?.storageNodes ?? []).map((node) => node.id),
            serverAccess: serverGrants,
            serverAccessScopeIds: (payload?.servers ?? []).map((server) => server.id),
          } : {}),
        }),
      });
      setMessage({ type: "success", text: t("usersPerm.success.saved") });
      onSaved();
    } catch (error) {
      setMessage({ type: "error", text: getErrorMessage(error, t("usersPerm.error.saveFailed")) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      size="full"
      placement="top"
      open
      onClose={onClose}
      closeOnBackdrop={false}
      busy={saving}
      eyebrow={t("usersPerm.title")}
      title={payload?.user.displayName ?? username}
      description={t("usersPerm.desc")}
      closeLabel={t("usersPerm.action.close")}
      footer={<>
        <ActionButton variant="secondary" onClick={onClose}>{t("usersPerm.action.cancel")}</ActionButton>
        {payload && (!resourceOnly || !payload.user.resourceAccessBypassed) ? (
          <ActionButton onClick={save} loading={saving}>{saving ? t("usersPerm.action.saving") : t("usersPerm.action.save")}</ActionButton>
        ) : null}
      </>}
    >
        {message && <Notice tone={message.type === "success" ? "success" : "danger"} compact className="mb-4">{message.text}</Notice>}
        {loading || !payload ? <InlineLoading label={t("usersPerm.loading")} /> : (
          <div className="space-y-6">
            {!resourceOnly && <section data-inset className="p-4">
              <h4 className="ui-title-group">{t("usersPerm.template.title")}</h4>
              <p className="mt-1 text-xs text-[var(--text-muted)]">{t("usersPerm.template.desc")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <select aria-label={t("usersPerm.template.select")} value={selectedTemplateId} onChange={(event) => { setSelectedTemplateId(event.target.value); setConfirmingTemplateDelete(false); }} className={cn(UI_INPUT, "w-auto min-h-10 text-sm")}>
                  <option value="">{t("usersPerm.template.select")}</option>
                  {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                </select>
                <ActionButton variant="outline" onClick={applyTemplate} disabled={!selectedTemplateId}>{t("usersPerm.template.apply")}</ActionButton>
                {selectedTemplate && !selectedTemplate.isBuiltin && <ActionButton variant="secondary" onClick={updateSelectedTemplate} disabled={savingTemplate}>{t("usersPerm.template.update")}</ActionButton>}
                {/* Custom templates were creatable but never removable from the UI;
                    built-ins stay read-only because the API refuses to delete them. */}
                {selectedTemplate && !selectedTemplate.isBuiltin && (confirmingTemplateDelete ? (
                  <>
                    <ActionButton variant="danger-solid" onClick={deleteSelectedTemplate} disabled={deletingTemplate}>
                      {deletingTemplate ? "…" : t("usersPerm.template.deleteConfirm")}
                    </ActionButton>
                    <ActionButton variant="secondary" onClick={() => setConfirmingTemplateDelete(false)} disabled={deletingTemplate}>
                      {t("usersPerm.action.cancel")}
                    </ActionButton>
                  </>
                ) : (
                  <ActionButton variant="danger" onClick={() => setConfirmingTemplateDelete(true)}>
                    {t("usersPerm.template.delete")}
                  </ActionButton>
                ))}
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={templateNameDraft}
                    onChange={(e) => setTemplateNameDraft(e.target.value)}
                    placeholder={t("usersPerm.template.namePrompt")}
                    aria-label={t("usersPerm.template.namePrompt")}
                    className={cn(UI_INPUT, "min-w-[10rem] flex-1 text-sm")}
                  />
                  <ActionButton variant="secondary"
                    onClick={saveTemplate}
                    disabled={savingTemplate || !templateNameDraft.trim()}>
                    {savingTemplate ? "…" : t("usersPerm.template.saveCurrent")}
                  </ActionButton>
                </div>
              </div>
            </section>}
            {!resourceOnly && <section data-inset className="p-4">
              <h4 className="ui-title-group">{t("usersPerm.section.roles")}</h4>
              <div className="mt-3 flex flex-wrap gap-2">
                {payload.roles.map((role) => (
                  <Chip key={role.key} selected={roleKeys.includes(role.key)} onClick={() => setRoleKeys((current) => toggle(current, role.key))}>{t(`usersPage.role.${role.key}`)}</Chip>
                ))}
              </div>
            </section>}

            {!resourceOnly && <section data-inset className="p-4">
              <h4 className="ui-title-group">{t("usersPerm.section.perms")}</h4>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <p className="mb-2 text-xs text-[var(--text-muted)]">
                  {t("usersPerm.perms.directHint")}
                </p>
                {payload.permissions.map((permission) => {
                  const direct = permissionKeys.includes(permission.key);
                  const effective = payload.user.effectivePermissions.includes(permission.key);
                  return (
                  <label key={permission.key} data-tile="" data-selected={direct ? "" : undefined} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-[var(--text-secondary)]">
                    <input type="checkbox" checked={direct} onChange={() => setPermissionKeys((current) => toggle(current, permission.key))} />
                    <span>{permission.name || permission.key}</span>
                    <span className="text-xs text-[var(--text-muted)]">{permission.key}{effective && !direct ? ` · ${t("usersPerm.perms.viaRole")}` : ""}</span>
                  </label>
                  );
                })}
              </div>
            </section>}

            {payload.user.resourceAccessBypassed && <Notice tone="info">{t("usersPerm.adminResourceAccess")}</Notice>}

            {!payload.user.resourceAccessBypassed && <section data-inset className="p-4">
              <h4 className="ui-title-group">{t("usersPerm.section.servers")}</h4>
              <p className="mt-1 text-xs text-[var(--text-muted)]">{t("usersPerm.servers.hint")}</p>
              <div className="mt-3 space-y-3">
                {(payload.servers ?? []).length === 0 ? <EmptyState>{t("usersPerm.servers.empty")}</EmptyState> :
                  (payload.servers ?? []).map((server) => {
                    const grant = serverGrants.find((item) => item.serverId === server.id);
                    const capabilities = [
                      ["canRead", "read"], ["canConnect", "connect"], ["canManage", "manage"],
                      ["canFileRead", "fileRead"], ["canFileWrite", "fileWrite"], ["canFileDelete", "fileDelete"],
                    ] as const;
                    return <div key={server.id} data-card className="p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-[var(--text-primary)]">{server.name} <span className="text-xs text-[var(--text-muted)]">{server.operatingSystem}</span></span>
                        <ActionButton size="sm" variant="secondary" onClick={() => setServerGrants((current) => grant
                          ? current.filter((item) => item.serverId !== server.id)
                          : [...current, {
                            serverId: server.id,
                            canRead: payload.user.effectivePermissions.includes("server:read"),
                            canConnect: payload.user.effectivePermissions.includes("server:ssh"),
                            canManage: payload.user.effectivePermissions.includes("server:write"),
                            canFileRead: payload.user.effectivePermissions.includes("server:ssh"),
                            canFileWrite: payload.user.effectivePermissions.includes("server:ssh"),
                            canFileDelete: payload.user.effectivePermissions.includes("server:ssh"),
                          }])}>{grant ? t("usersPerm.servers.inherit") : t("usersPerm.servers.override")}</ActionButton>
                      </div>
                      {grant ? <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        {capabilities.map(([field, label]) => <label key={field} className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                          <input type="checkbox" checked={grant[field]} onChange={(event) => setServerGrants((current) => current.map((item) => item.serverId === server.id ? { ...item, [field]: event.target.checked } : item))} />
                          {t(`usersPerm.servers.${label}`)}
                        </label>)}
                      </div> : <p className="mt-1 text-xs text-[var(--text-muted)]">{t("usersPerm.servers.inherited")}</p>}
                    </div>;
                  })}
              </div>
            </section>}

            {!payload.user.resourceAccessBypassed && <section data-inset className="p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="ui-title-group">{t("usersPerm.section.grants")}</h4>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">{t("usersPerm.grants.hint")}</p>
                </div>
                <ActionButton icon={<Plus size={16} aria-hidden />} size="sm" variant="success" onClick={addGrant}>{t("usersPerm.action.addGrant")}</ActionButton>
              </div>
              <div className="mt-4 space-y-3">
                {grants.length === 0 ? <EmptyState>{t("usersPerm.grants.empty")}</EmptyState> : grants.map((grant, index) => {
                  const node = storageNodeMap.get(grant.storageNodeId);
                  return (
                    <div key={`${grant.storageNodeId}-${index}`} data-card className="p-4">
                      <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr_1fr_1fr_auto]">
                        <label className="sr-only" htmlFor={`grantNode-${index}`}>{t("usersPerm.grants.node")}</label>
                        <select id={`grantNode-${index}`} value={grant.storageNodeId} onChange={(e) => updateGrant(index, { storageNodeId: e.target.value })} className={cn(UI_INPUT, "text-sm")}>
                          {payload.storageNodes.map((item) => <option key={item.id} value={item.id}>{item.name} · {getStorageDriverLabel(t, item.driver)}</option>)}
                        </select>
                        <label className="sr-only" htmlFor={`grantPath-${index}`}>{t("usersPerm.grants.path")}</label>
                        <input id={`grantPath-${index}`} value={grant.pathPrefix} onChange={(e) => updateGrant(index, { pathPrefix: e.target.value })} placeholder={t("usersPerm.grants.pathPlaceholder")} className={cn(UI_INPUT, "text-sm")} />
                        <label className="sr-only" htmlFor={`grantQuota-${index}`}>{t("usersPerm.grants.quota")}</label>
                        <input id={`grantQuota-${index}`} value={grant.quotaBytes ?? ""} onChange={(e) => updateGrant(index, { quotaBytes: e.target.value })} placeholder={t("usersPerm.grants.quotaPlaceholder")} className={cn(UI_INPUT, "text-sm")} />
                        <label className="sr-only" htmlFor={`grantMaxFile-${index}`}>{t("usersPerm.grants.maxFile")}</label>
                        <input id={`grantMaxFile-${index}`} value={grant.maxFileBytes ?? ""} onChange={(e) => updateGrant(index, { maxFileBytes: e.target.value })} placeholder={t("usersPerm.grants.maxFilePlaceholder")} className={cn(UI_INPUT, "text-sm")} />
                        <ActionButton size="sm" variant="danger" onClick={() => setGrants((current) => current.filter((_, i) => i !== index))}>{t("usersPerm.action.delete")}</ActionButton>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-[var(--text-secondary)]">
                        <label><input type="checkbox" checked={grant.canRead} onChange={(e) => updateGrant(index, { canRead: e.target.checked })} /> {t("usersPerm.grants.read")}</label>
                        <label><input type="checkbox" checked={grant.canWrite} onChange={(e) => updateGrant(index, { canWrite: e.target.checked })} /> {t("usersPerm.grants.write")}</label>
                        <label><input type="checkbox" checked={grant.canDelete} onChange={(e) => updateGrant(index, { canDelete: e.target.checked })} /> {t("usersPerm.grants.delete")}</label>
                        <span>{t("usersPerm.grants.used", { value: formatBytes(grant.usedBytes, t) })}</span>
                        {node && <span className="text-[var(--text-muted)]">{t("usersPerm.grants.basePath", { path: node.basePath })}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>}

          </div>
        )}
    </Dialog>
  );
}
