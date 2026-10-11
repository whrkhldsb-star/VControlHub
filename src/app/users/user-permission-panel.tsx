"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { formatBytes as formatBytesShared } from "@/lib/format/bytes";
import { EmptyState } from "@/components/page-shell";
import { Badge, Chip, InlineLoading, Notice } from "@/components/ui-primitives";
import { useI18n } from "@/lib/i18n/use-locale";
import { Dialog } from "@/components/ui/dialog";
import { getErrorMessage } from "@/lib/http/error-message";
import { ActionButton } from "@/components/action-button";
import { getStorageDriverLabel } from "@/lib/i18n/domain-labels";
import { Plus } from "@/components/icons";
import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";
import { groupPermissionsByDomain, permissionLabelKey } from "@/lib/auth/permission-labels";
import { identityTemplateName } from "@/lib/auth/identity-templates";

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
type IdentityTemplateInfo = { id: string; name: string; isBuiltin: boolean; permissions: string[] };
type AccountType = "admin" | "customer";

type PermissionsPayload = {
  user: {
    id: string;
    username: string;
    displayName: string | null;
    accountType: AccountType;
    teamId: string | null;
    identityTemplateId: string | null;
    effectivePermissions: string[];
    storageAccess: StorageGrant[];
    serverAccess?: ServerGrant[];
  };
  identityTemplates: IdentityTemplateInfo[];
  customers: Array<{ id: string; name: string }>;
  storageNodes: StorageNodeInfo[];
  servers?: ServerInfo[];
};

type Props = {
  userId: string;
  username: string;
  onClose: () => void;
  onSaved: () => void;
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

export function UserPermissionPanel({ userId, username, onClose, onSaved }: Props) {
  const { t } = useI18n();
  // Reach the translator from the load effect without putting `t` in its deps:
  // a locale switch must not refetch and overwrite unsaved admin edits.
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; }, [t]);
  const [payload, setPayload] = useState<PermissionsPayload | null>(null);
  const [accountType, setAccountType] = useState<AccountType>("customer");
  const [teamId, setTeamId] = useState("");
  const [identityTemplateId, setIdentityTemplateId] = useState("");
  const [grants, setGrants] = useState<StorageGrant[]>([]);
  const [serverGrants, setServerGrants] = useState<ServerGrant[]>([]);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    csrfFetch<PermissionsPayload>(`/api/users/permissions?userId=${encodeURIComponent(userId)}`)
      .then((data) => {
        if (cancelled) return;
        setPayload(data);
        setAccountType(data.user.accountType);
        setTeamId(data.user.teamId ?? data.customers[0]?.id ?? "");
        setIdentityTemplateId(data.user.identityTemplateId ?? "identity:viewer");
        setGrants(data.user.storageAccess.map((grant) => ({ ...grant })));
        setServerGrants((data.user.serverAccess ?? []).map((grant) => ({ ...grant })));
      })
      .catch((error) => !cancelled && setMessage({ type: "error", text: getErrorMessage(error, tRef.current("usersPerm.error.loadFailed")) }))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [userId]);

  const storageNodeMap = useMemo(() => new Map(payload?.storageNodes.map((node) => [node.id, node]) ?? []), [payload]);
  const selectedTemplate = payload?.identityTemplates.find((template) => template.id === identityTemplateId) ?? null;
  const accountChanged = Boolean(payload) && (
    accountType !== payload!.user.accountType
    || (accountType === "customer" && (teamId !== payload!.user.teamId || identityTemplateId !== payload!.user.identityTemplateId))
  );
  // Narrowing lists the saved customer's servers; edit it once the customer is saved.
  const narrowingEditable = accountType === "customer" && Boolean(payload?.user.teamId) && teamId === payload?.user.teamId;
  const previewPermissions = accountType === "admin" ? null : groupPermissionsByDomain(selectedTemplate?.permissions ?? []);

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
    const normalizedGrants = normalizeStorageGrants(grants);
    if (!normalizedGrants) {
      setMessage({ type: "error", text: t("usersPerm.error.invalidQuota") });
      setSaving(false);
      return;
    }
    try {
      await csrfFetch("/api/users/permissions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          ...(accountChanged
            ? { account: accountType === "admin" ? { type: "admin" } : { type: "customer", teamId, identityTemplateId } }
            : {}),
          ...(narrowingEditable ? {
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
        {payload ? <ActionButton onClick={save} loading={saving}>{saving ? t("usersPerm.action.saving") : t("usersPerm.action.save")}</ActionButton> : null}
      </>}
    >
        {message && <Notice tone={message.type === "success" ? "success" : "danger"} compact className="mb-4">{message.text}</Notice>}
        {loading || !payload ? <InlineLoading label={t("usersPerm.loading")} /> : (
          <div className="space-y-6">
            <section data-inset className="p-4">
              <h4 className="ui-title-group">{t("usersPerm.account.title")}</h4>
              <p className="mt-1 text-xs text-[var(--text-muted)]">{t("usersPerm.account.desc")}</p>
              <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label={t("usersPerm.account.title")}>
                {(["customer", "admin"] as const).map((type) => (
                  <Chip key={type} selected={accountType === type} onClick={() => setAccountType(type)}>{t(`usersPerm.account.type.${type}`)}</Chip>
                ))}
              </div>
              {accountType === "customer" && (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="text-sm text-[var(--text-secondary)]">
                    <span className="ui-label mb-1 block">{t("usersPerm.account.customer")}</span>
                    <select value={teamId} onChange={(event) => setTeamId(event.target.value)} className={cn(UI_INPUT, "text-sm")}>
                      {payload.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
                    </select>
                  </label>
                  <label className="text-sm text-[var(--text-secondary)]">
                    <span className="ui-label mb-1 block">{t("usersPerm.account.template")}</span>
                    <select value={identityTemplateId} onChange={(event) => setIdentityTemplateId(event.target.value)} className={cn(UI_INPUT, "text-sm")}>
                      {payload.identityTemplates.map((template) => <option key={template.id} value={template.id}>{identityTemplateName(template, t)}</option>)}
                    </select>
                  </label>
                </div>
              )}
              <div className="mt-4">
                <h5 className="ui-label">{t("usersPerm.account.effective")}</h5>
                {previewPermissions === null ? (
                  <p className="mt-1 text-xs text-[var(--text-muted)]">{t("usersPerm.account.adminAll")}</p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {previewPermissions.map((group) => (
                      <div key={group.domain} className="flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="w-24 shrink-0 text-[var(--text-muted)]">{t(group.labelKey)}</span>
                        {group.permissions.map((permission) => <Badge key={permission} tone="neutral">{t(permissionLabelKey(permission))}</Badge>)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {accountType === "admin" && <Notice tone="info">{t("usersPerm.adminResourceAccess")}</Notice>}
            {accountType === "customer" && !narrowingEditable && <Notice tone="info">{t("usersPerm.narrowAfterSave")}</Notice>}

            {narrowingEditable && <section data-inset className="p-4">
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

            {narrowingEditable && <section data-inset className="p-4">
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
