"use client";

import { useEffect, useMemo, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { EmptyState } from "@/components/page-shell";
import { useI18n } from "@/lib/i18n/use-locale";

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
    storageAccess: StorageGrant[];
  };
  roles: RoleInfo[];
  permissions: PermissionInfo[];
  storageNodes: StorageNodeInfo[];
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
  const [payload, setPayload] = useState<PermissionsPayload | null>(null);
  const [roleKeys, setRoleKeys] = useState<string[]>([]);
  const [permissionKeys, setPermissionKeys] = useState<string[]>([]);
  const [grants, setGrants] = useState<StorageGrant[]>([]);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
csrfFetch(`/api/users/permissions?userId=${encodeURIComponent(userId)}`)
.then((data) => {
return data as PermissionsPayload;
})
      .then((data) => {
        if (cancelled) return;
        setPayload(data);
        setRoleKeys(data.user.roles.map((role) => role.key));
        setPermissionKeys(data.user.effectivePermissions);
        setGrants(data.user.storageAccess.map((grant) => ({ ...grant })));
      })
      .catch((error) => !cancelled && setMessage({ type: "error", text: error instanceof Error ? error.message : t("usersPerm.error.loadFailed") }))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [userId, t]);

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
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 p-4 backdrop-blur">
      <div className="mx-auto max-w-5xl rounded-3xl border border-[var(--border)] bg-slate-950 p-6 shadow-2xl shadow-cyan-950/40">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-cyan-300/70">{t("usersPerm.title")}</p>
            <h3 className="mt-1 text-xl font-semibold text-white">{payload?.user.displayName ?? username}</h3>
            <p className="mt-1 text-sm text-slate-400">{t("usersPerm.desc")}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-[var(--border)] px-3 py-1.5 text-sm text-slate-300 hover:bg-white/10">{t("usersPerm.action.close")}</button>
        </div>

        {message && <div className={`mb-4 rounded-2xl border px-4 py-3 text-sm ${message.type === "success" ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100" : "border-rose-400/30 bg-rose-400/10 text-rose-100"}`}>{message.text}</div>}
        {loading || !payload ? <EmptyState>{t("usersPerm.loading")}</EmptyState> : (
          <div className="space-y-6">
            <section className="rounded-2xl border border-[var(--border)] bg-white/[0.03] p-4">
              <h4 className="font-medium text-white">{t("usersPerm.section.roles")}</h4>
              <div className="mt-3 flex flex-wrap gap-2">
                {payload.roles.map((role) => (
                  <button key={role.key} type="button" onClick={() => setRoleKeys((current) => toggle(current, role.key))} className={`rounded-full border px-3 py-1.5 text-xs ${roleKeys.includes(role.key) ? "border-cyan-400/40 bg-cyan-400/15 text-cyan-100" : "border-white/10 bg-white/5 text-slate-400"}`}>{role.name}</button>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-[var(--border)] bg-white/[0.03] p-4">
              <h4 className="font-medium text-white">{t("usersPerm.section.perms")}</h4>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {payload.permissions.map((permission) => (
                  <label key={permission.key} className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-slate-950/60 px-3 py-2 text-sm text-slate-200">
                    <input type="checkbox" checked={permissionKeys.includes(permission.key)} onChange={() => setPermissionKeys((current) => toggle(current, permission.key))} />
                    <span>{permission.name || permission.key}</span>
                    <span className="text-xs text-slate-500">{permission.key}</span>
                  </label>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-[var(--border)] bg-white/[0.03] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="font-medium text-white">{t("usersPerm.section.grants")}</h4>
                  <p className="mt-1 text-xs text-slate-400">{t("usersPerm.grants.hint")}</p>
                </div>
                <button type="button" onClick={addGrant} data-tone="emerald" className="rounded-full border border-emerald-400/30 px-3 py-1.5 text-xs text-emerald-100 hover:bg-emerald-400/20">{t("usersPerm.action.addGrant")}</button>
              </div>
              <div className="mt-4 space-y-3">
                {grants.length === 0 ? <EmptyState>{t("usersPerm.grants.empty")}</EmptyState> : grants.map((grant, index) => {
                  const node = storageNodeMap.get(grant.storageNodeId);
                  return (
                    <div key={`${grant.storageNodeId}-${index}`} className="rounded-2xl border border-[var(--border)] bg-slate-950/70 p-4">
                      <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr_1fr_1fr_auto]">
                        <label className="sr-only" htmlFor={`grantNode-${index}`}>{t("usersPerm.grants.node")}</label>
                        <select id={`grantNode-${index}`} value={grant.storageNodeId} onChange={(e) => updateGrant(index, { storageNodeId: e.target.value })} className="rounded-xl border border-[var(--border)] bg-slate-950 px-3 py-2 text-sm text-white">
                          {payload.storageNodes.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.driver}</option>)}
                        </select>
                        <label className="sr-only" htmlFor={`grantPath-${index}`}>{t("usersPerm.grants.path")}</label>
                        <input id={`grantPath-${index}`} value={grant.pathPrefix} onChange={(e) => updateGrant(index, { pathPrefix: e.target.value })} placeholder={t("usersPerm.grants.pathPlaceholder")} className="rounded-xl border border-[var(--border)] bg-slate-950 px-3 py-2 text-sm text-white" />
                        <label className="sr-only" htmlFor={`grantQuota-${index}`}>{t("usersPerm.grants.quota")}</label>
                        <input id={`grantQuota-${index}`} value={grant.quotaBytes ?? ""} onChange={(e) => updateGrant(index, { quotaBytes: e.target.value })} placeholder={t("usersPerm.grants.quotaPlaceholder")} className="rounded-xl border border-[var(--border)] bg-slate-950 px-3 py-2 text-sm text-white" />
                        <label className="sr-only" htmlFor={`grantMaxFile-${index}`}>{t("usersPerm.grants.maxFile")}</label>
                        <input id={`grantMaxFile-${index}`} value={grant.maxFileBytes ?? ""} onChange={(e) => updateGrant(index, { maxFileBytes: e.target.value })} placeholder={t("usersPerm.grants.maxFilePlaceholder")} className="rounded-xl border border-[var(--border)] bg-slate-950 px-3 py-2 text-sm text-white" />
                        <button type="button" onClick={() => setGrants((current) => current.filter((_, i) => i !== index))} className="rounded-xl border border-rose-400/30 px-3 py-2 text-xs text-rose-100 hover:bg-rose-400/10">{t("usersPerm.action.delete")}</button>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-300">
                        <label><input type="checkbox" checked={grant.canRead} onChange={(e) => updateGrant(index, { canRead: e.target.checked })} /> {t("usersPerm.grants.read")}</label>
                        <label><input type="checkbox" checked={grant.canWrite} onChange={(e) => updateGrant(index, { canWrite: e.target.checked })} /> {t("usersPerm.grants.write")}</label>
                        <label><input type="checkbox" checked={grant.canDelete} onChange={(e) => updateGrant(index, { canDelete: e.target.checked })} /> {t("usersPerm.grants.delete")}</label>
                        <span>{t("usersPerm.grants.used").replace("{value}", formatBytes(grant.usedBytes, t))}</span>
                        {node && <span className="text-slate-500">{t("usersPerm.grants.basePath").replace("{path}", node.basePath)}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <div className="flex justify-end gap-3">
              <button type="button" onClick={onClose} className="rounded-full border border-[var(--border)] px-5 py-2 text-sm text-slate-300 hover:bg-white/10">{t("usersPerm.action.cancel")}</button>
              <button type="button" onClick={save} disabled={saving} data-tone="cyan" className="rounded-full border border-cyan-400/30 px-5 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-400/20 disabled:opacity-50">{saving ? t("usersPerm.action.saving") : t("usersPerm.action.save")}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
