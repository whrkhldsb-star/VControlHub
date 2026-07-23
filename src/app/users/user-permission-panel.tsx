"use client";

import { useEffect, useMemo, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { EmptyState } from "@/components/page-shell";
import { useI18n } from "@/lib/i18n/use-locale";
import { useDialogFocus } from "@/lib/a11y/use-dialog-focus";

type RoleInfo = { key: string; name: string; description?: string | null };
type PermissionInfo = { key: string; name: string; description?: string | null };
type StorageNodeInfo = { id: string; name: string; driver: string; basePath: string };
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
    /** Fine-grained custom role only (not base role grants). */
    directPermissionKeys?: string[];
    storageAccess: StorageGrant[];
  };
  roles: RoleInfo[];
  permissions: PermissionInfo[];
  storageNodes: StorageNodeInfo[];
};

type RoleTemplate = {
  id: string;
  name: string;
  description: string | null;
  roleKeys: string[];
  permissions: string[];
  storageAccess: StorageGrant[];
};

type Props = {
  userId: string;
  username: string;
  onClose: () => void;
  onSaved: () => void;
};

function formatBytes(value: string | null | undefined, t: (k: string) => string) {
  if (!value) return t("usersPerm.bytes.unlimited");
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return t("usersPerm.bytes.unlimited");
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function toBytes(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(kb|mb|gb|tb)$/i);
  if (!match) return null;
  const factor: Record<string, number> = { kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 };
  return String(Math.floor(Number(match[1]!) * factor[match[2]!.toLowerCase()]!));
}

export function UserPermissionPanel({ userId, username, onClose, onSaved }: Props) {
  const { t } = useI18n();
  const dialogRef = useDialogFocus<HTMLDivElement>({ open: true, onClose });
  const [payload, setPayload] = useState<PermissionsPayload | null>(null);
  const [roleKeys, setRoleKeys] = useState<string[]>([]);
  const [permissionKeys, setPermissionKeys] = useState<string[]>([]);
  const [grants, setGrants] = useState<StorageGrant[]>([]);
  const [templateNameDraft, setTemplateNameDraft] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState<RoleTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");

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
      })
      .catch((error) => !cancelled && setMessage({ type: "error", text: error instanceof Error ? error.message : t("usersPerm.error.loadFailed") }))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [userId, t]);

  useEffect(() => {
    csrfFetch("/api/role-templates")
      .then((data) => setTemplates((data as { templates?: RoleTemplate[] }).templates ?? []))
      .catch(() => setTemplates([]));
  }, []);

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
    setMessage({ type: "success", text: t("usersPerm.template.applied") });
  };

  const saveTemplate = async () => {
    const name = templateNameDraft.trim();
    if (!name) {
      setMessage({ type: "error", text: t("usersPerm.template.namePrompt") });
      return;
    }
    setSavingTemplate(true);
    try {
      const data = await csrfFetch("/api/role-templates", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, roleKeys, permissions: permissionKeys, storageAccess: grants }),
      }) as { template: RoleTemplate };
      setTemplates((current) => [...current, data.template].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedTemplateId(data.template.id);
      setTemplateNameDraft("");
      setMessage({ type: "success", text: t("usersPerm.template.saved") });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : t("usersPerm.error.saveFailed") });
    } finally {
      setSavingTemplate(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    const normalizedGrants = grants.map((grant) => ({
      storageNodeId: grant.storageNodeId,
      pathPrefix: grant.pathPrefix,
      canRead: grant.canRead,
      canWrite: grant.canWrite,
      canDelete: grant.canDelete,
      quotaBytes: toBytes(grant.quotaBytes ?? ""),
      maxFileBytes: toBytes(grant.maxFileBytes ?? ""),
    }));

    try {
const _data = await csrfFetch("/api/users/permissions", {
		method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, roleKeys, permissionKeys, storageAccess: normalizedGrants }),
      });
      setMessage({ type: "success", text: t("usersPerm.success.saved") });
      onSaved();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : t("usersPerm.error.saveFailed") });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[var(--overlay)] p-4 backdrop-blur">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t("usersPerm.title")} className="mx-auto max-w-5xl rounded-3xl border border-[var(--border)] bg-[var(--modal-bg)] p-6 shadow-2xl shadow-[var(--color-action)]/40">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-action)]/70">{t("usersPerm.title")}</p>
            <h3 className="mt-1 text-xl font-semibold text-[var(--text-primary)]">{payload?.user.displayName ?? username}</h3>
            <p className="mt-1 text-sm text-[var(--text-muted)]">{t("usersPerm.desc")}</p>
          </div>
          <button type="button" onClick={onClose} data-action-button data-variant="secondary" className="!px-3 !py-1.5 !text-sm">{t("usersPerm.action.close")}</button>
        </div>

        {message && <div className={`mb-4 rounded-2xl border px-4 py-3 text-sm ${message.type === "success" ? "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]" : "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger)]"}`}>{message.text}</div>}
        {loading || !payload ? <EmptyState>{t("usersPerm.loading")}</EmptyState> : (
          <div className="space-y-6">
            <section className="rounded-2xl border border-[var(--accent-border)] bg-[var(--accent-bg)] p-4">
              <h4 className="font-medium text-[var(--text-primary)]">{t("usersPerm.template.title")}</h4>
              <p className="mt-1 text-xs text-[var(--text-muted)]">{t("usersPerm.template.desc")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <select value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)} className="min-h-10 rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm text-[var(--text-primary)]">
                  <option value="">{t("usersPerm.template.select")}</option>
                  {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                </select>
                <button type="button" onClick={applyTemplate} disabled={!selectedTemplateId} data-action-button data-variant="outline" className="!px-3 !py-2 !text-xs disabled:opacity-40">{t("usersPerm.template.apply")}</button>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={templateNameDraft}
                    onChange={(e) => setTemplateNameDraft(e.target.value)}
                    placeholder={t("usersPerm.template.namePrompt")}
                    aria-label={t("usersPerm.template.namePrompt")}
                    className="min-w-[10rem] flex-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm text-[var(--text-primary)]"
                  />
                  <button
                    type="button"
                    onClick={saveTemplate}
                    disabled={savingTemplate || !templateNameDraft.trim()}
                    data-action-button
                    data-variant="secondary"
                    className="!px-3 !py-2 !text-xs disabled:opacity-50"
                  >
                    {savingTemplate ? "…" : t("usersPerm.template.saveCurrent")}
                  </button>
                </div>
              </div>
            </section>
            <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4">
              <h4 className="font-medium text-[var(--text-primary)]">{t("usersPerm.section.roles")}</h4>
              <div className="mt-3 flex flex-wrap gap-2">
                {payload.roles.map((role) => (
                  <button key={role.key} type="button" onClick={() => setRoleKeys((current) => toggle(current, role.key))} data-tone={roleKeys.includes(role.key) ? "cyan" : undefined} className={`rounded-full border px-3 py-1.5 text-xs ${roleKeys.includes(role.key) ? "border-[var(--accent-border)] text-[var(--accent)]" : "border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-elevated)]"}`}>{t(`usersPage.role.${role.key}`)}</button>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4">
              <h4 className="font-medium text-[var(--text-primary)]">{t("usersPerm.section.perms")}</h4>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <p className="mb-2 text-xs text-[var(--text-muted)]">
                  Checkboxes edit the user custom permission overrides only. Base role grants still apply until the role is removed.
                </p>
                {payload.permissions.map((permission) => {
                  const direct = permissionKeys.includes(permission.key);
                  const effective = payload.user.effectivePermissions.includes(permission.key);
                  return (
                  <label key={permission.key} className="flex items-center gap-2 rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-secondary)]">
                    <input type="checkbox" checked={direct} onChange={() => setPermissionKeys((current) => toggle(current, permission.key))} />
                    <span>{permission.name || permission.key}</span>
                    <span className="text-xs text-[var(--text-muted)]">{permission.key}{effective && !direct ? " · via role" : ""}</span>
                  </label>
                  );
                })}
              </div>
            </section>

            <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="font-medium text-[var(--text-primary)]">{t("usersPerm.section.grants")}</h4>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">{t("usersPerm.grants.hint")}</p>
                </div>
                <button type="button" onClick={addGrant} data-action-button data-variant="success" className="!px-3 !py-1.5 !text-xs">{t("usersPerm.action.addGrant")}</button>
              </div>
              <div className="mt-4 space-y-3">
                {grants.length === 0 ? <EmptyState>{t("usersPerm.grants.empty")}</EmptyState> : grants.map((grant, index) => {
                  const node = storageNodeMap.get(grant.storageNodeId);
                  return (
                    <div key={`${grant.storageNodeId}-${index}`} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                      <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr_1fr_1fr_auto]">
                        <label className="sr-only" htmlFor={`grantNode-${index}`}>{t("usersPerm.grants.node")}</label>
                        <select id={`grantNode-${index}`} value={grant.storageNodeId} onChange={(e) => updateGrant(index, { storageNodeId: e.target.value })} className="rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)]">
                          {payload.storageNodes.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.driver}</option>)}
                        </select>
                        <label className="sr-only" htmlFor={`grantPath-${index}`}>{t("usersPerm.grants.path")}</label>
                        <input id={`grantPath-${index}`} value={grant.pathPrefix} onChange={(e) => updateGrant(index, { pathPrefix: e.target.value })} placeholder={t("usersPerm.grants.pathPlaceholder")} className="rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)]" />
                        <label className="sr-only" htmlFor={`grantQuota-${index}`}>{t("usersPerm.grants.quota")}</label>
                        <input id={`grantQuota-${index}`} value={grant.quotaBytes ?? ""} onChange={(e) => updateGrant(index, { quotaBytes: e.target.value })} placeholder={t("usersPerm.grants.quotaPlaceholder")} className="rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)]" />
                        <label className="sr-only" htmlFor={`grantMaxFile-${index}`}>{t("usersPerm.grants.maxFile")}</label>
                        <input id={`grantMaxFile-${index}`} value={grant.maxFileBytes ?? ""} onChange={(e) => updateGrant(index, { maxFileBytes: e.target.value })} placeholder={t("usersPerm.grants.maxFilePlaceholder")} className="rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)]" />
                        <button type="button" onClick={() => setGrants((current) => current.filter((_, i) => i !== index))} className="rounded-xl border border-[var(--danger-border)] px-3 py-2 text-xs text-[var(--danger)] hover:bg-[var(--danger-bg)]">{t("usersPerm.action.delete")}</button>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-[var(--text-secondary)]">
                        <label><input type="checkbox" checked={grant.canRead} onChange={(e) => updateGrant(index, { canRead: e.target.checked })} /> {t("usersPerm.grants.read")}</label>
                        <label><input type="checkbox" checked={grant.canWrite} onChange={(e) => updateGrant(index, { canWrite: e.target.checked })} /> {t("usersPerm.grants.write")}</label>
                        <label><input type="checkbox" checked={grant.canDelete} onChange={(e) => updateGrant(index, { canDelete: e.target.checked })} /> {t("usersPerm.grants.delete")}</label>
                        <span>{t("usersPerm.grants.used").replace("{value}", formatBytes(grant.usedBytes, t))}</span>
                        {node && <span className="text-[var(--text-muted)]">{t("usersPerm.grants.basePath").replace("{path}", node.basePath)}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <div className="flex justify-end gap-3">
              <button type="button" onClick={onClose} data-action-button data-variant="secondary" className="!px-5 !py-2 !text-sm">{t("usersPerm.action.cancel")}</button>
              <button type="button" onClick={save} disabled={saving} data-action-button data-variant="outline" className="!px-5 !py-2 !text-sm disabled:opacity-50">{saving ? t("usersPerm.action.saving") : t("usersPerm.action.save")}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
