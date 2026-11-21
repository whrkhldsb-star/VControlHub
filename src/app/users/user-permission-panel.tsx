"use client";

import { useEffect, useRef, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { formatBytes as formatBytesShared } from "@/lib/format/bytes";
import { EmptyState } from "@/components/page-shell";
import { Badge, InlineLoading, Notice, SegmentedControl } from "@/components/ui-primitives";
import { useI18n } from "@/lib/i18n/use-locale";
import { Dialog } from "@/components/ui/dialog";
import { getErrorMessage } from "@/lib/http/error-message";
import { ActionButton } from "@/components/action-button";
import { useToast } from "@/components/toast-provider";
import { getStorageDriverLabel } from "@/lib/i18n/domain-labels";
import { Plus } from "@/components/icons";
import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";
import { groupPermissionsByDomain, permissionLabelKey } from "@/lib/auth/permission-labels";
import { identityTemplateName } from "@/lib/auth/identity-templates";

import { permissionChanges } from "@/lib/user/permission-editor-client";
import {
  readPermissionPage, usePermissionOptions, type PermissionOptionPage, type ServerInfo, type StorageNodeInfo, type IdentityTemplateInfo,
} from "./permission-option-page";

type ServerGrant = {
  server: ServerInfo;
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
  storageNode: StorageNodeInfo;
};
type AccountType = "admin" | "customer";

type PermissionsPayload = PermissionOptionPage & {
  version: string;
  user: {
    id: string;
    username: string;
    displayName: string | null;
    accountType: AccountType;
    teamId: string | null;
    identityTemplateId: string | null;
    effectivePermissions: string[];
    storageAccess: StorageGrant[];
    serverAccess: ServerGrant[];
  };
  customers: Array<{ id: string; name: string }>;
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

export function UserPermissionPanel(props: Props) {
  const [revision, setRevision] = useState(0);
  return <PermissionEditor key={`${props.userId}:${revision}`} {...props} reload={() => setRevision(value => value + 1)} />;
}

function PermissionEditor({ userId, username, onClose, onSaved, reload }: Props & { reload: () => void }) {
  const { t } = useI18n();
  // Reach the translator from the load effect without putting `t` in its deps:
  // a locale switch must not refetch and overwrite unsaved admin edits.
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; }, [t]);
  const [payload, setPayload] = useState<PermissionsPayload | null>(null);
  const [accountType, setAccountType] = useState<AccountType>("customer");
  const [teamId, setTeamId] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<IdentityTemplateInfo | null>(null);
  const identityTemplateId = selectedTemplate?.id ?? "identity:viewer";
  const [grants, setGrants] = useState<StorageGrant[]>([]);
  const [newNodeId, setNewNodeId] = useState("");
  const [serverGrants, setServerGrants] = useState<ServerGrant[]>([]);
  // A refusal stays in the dialog, at its top; that it was saved is a toast, which is in view wherever the
  // long dialog has been scrolled to (the Save button is in its footer).
  const [message, setMessage] = useState<{ type: "error"; text: string } | null>(null);
  const { addToast } = useToast();
  const bodyTopRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      const data = await readPermissionPage<PermissionsPayload>(userId, { includeAssigned: "1" }, controller.signal);
      const id = data.user.identityTemplateId ?? "identity:viewer";
      const template = data.identityTemplates.find(item => item.id === id)
        ?? (await readPermissionPage(userId, { resource: "identityTemplates", id, pageSize: "1" }, controller.signal)).identityTemplates.find(item => item.id === id);
      if (controller.signal.aborted) return;
      setPayload(data);
      setAccountType(data.user.accountType);
      setTeamId(data.user.teamId ?? data.customers[0]?.id ?? "");
      // A template can disappear between the initial read and its ID lookup.
      // Preserve the saved ID until the administrator chooses a replacement.
      setSelectedTemplate(template ?? { id, name: id, isBuiltin: false, permissions: [] });
      setGrants(data.user.storageAccess);
      setServerGrants(data.user.serverAccess);
    };
    load().catch(error => {
      if (!controller.signal.aborted) setMessage({ type: "error", text: getErrorMessage(error, tRef.current("usersPerm.error.loadFailed")) });
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [userId]);

  // A refusal is shown at the top: bring it into view when the dialog has been scrolled down to the fields.
  useEffect(() => {
    if (message) bodyTopRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [message]);

  const templates = usePermissionOptions(userId, "identityTemplates", t("usersPerm.account.template"), payload, selectedTemplate ? [selectedTemplate] : []);
  const nodes = usePermissionOptions(userId, "storageNodes", t("usersPerm.grants.node"), payload);
  const nodesById = new Map(nodes.options.map(node => [node.id, node]));
  const newNode = nodesById.get(newNodeId) ?? nodes.options[0];
  const servers = usePermissionOptions(userId, "servers", t("usersPerm.section.servers"), payload, serverGrants.map(grant => grant.server));
  const serverGrantMap = new Map(serverGrants.map(grant => [grant.serverId, grant]));
  const accountChanged = Boolean(payload) && (
    accountType !== payload!.user.accountType
    || (accountType === "customer" && (teamId !== payload!.user.teamId || identityTemplateId !== payload!.user.identityTemplateId))
  );
  // Narrowing lists the saved customer's servers; edit it once the customer is saved.
  const narrowingEditable = accountType === "customer" && Boolean(payload?.user.teamId) && teamId === payload?.user.teamId;
  const previewPermissions = accountType === "admin" ? null : groupPermissionsByDomain(selectedTemplate?.permissions ?? []);

  const addGrant = () => {
    if (!newNode) return;
    setGrants((current) => [...current, {
      storageNodeId: newNode.id,
      storageNode: newNode,
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
    if (!payload) return;
    setSaving(true);
    setMessage(null);
    const normalizedGrants = normalizeStorageGrants(grants);
    if (!normalizedGrants) {
      setMessage({ type: "error", text: t("usersPerm.error.invalidQuota") });
      setSaving(false);
      return;
    }
    try {
      const patch = permissionChanges(payload, {
        userId,
        account: accountChanged ? (accountType === "admin" ? { type: "admin" } : { type: "customer", teamId, identityTemplateId }) : undefined,
        ...(narrowingEditable ? {
          storageAccess: normalizedGrants,
          storageAccessScopeIds: [...payload.user.storageAccess, ...grants].map(grant => grant.storageNodeId),
          serverAccess: serverGrants,
          serverAccessScopeIds: [...payload.user.serverAccess, ...serverGrants].map(grant => grant.serverId),
        } : {}),
      });
      const { version } = await csrfFetch<{ version: string }>("/api/users/permissions", {
        method: "PATCH", body: JSON.stringify(patch),
      });
      // Keep the snapshot that was actually committed, including normalized byte limits.
      setPayload({
        ...payload, version,
        user: { ...payload.user, storageAccess: grants.map((grant, i) => ({ ...grant, ...normalizedGrants[i] })), serverAccess: serverGrants },
      });
      addToast("success", t("usersPerm.success.saved"));
      // Moved to another customer (or between administrator and customer): what can be narrowed is different now.
      if (accountChanged) reload();
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
        <div ref={bodyTopRef} />
        {message && <Notice tone="danger" compact className="mb-4">{message.text}</Notice>}
        {/* Not loading and nothing loaded: the reason is above, and there is nothing to wait for. */}
        {loading ? <InlineLoading label={t("usersPerm.loading")} /> : !payload ? null : (
          <fieldset disabled={saving} className="min-w-0 space-y-6">
            <section data-inset className="p-4">
              <h4 className="ui-title-group">{t("usersPerm.account.title")}</h4>
              <p className="mt-1 text-xs text-[var(--text-muted)]">{t("usersPerm.account.desc")}</p>
              <SegmentedControl
                className="mt-3"
                ariaLabel={t("usersPerm.account.title")}
                value={accountType}
                onChange={setAccountType}
                options={(["customer", "admin"] as const).map((type) => ({ value: type, label: t(`usersPerm.account.type.${type}`) }))}
              />
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
                    <select value={identityTemplateId} onChange={(event) => setSelectedTemplate(templates.options.find(item => item.id === event.target.value) ?? null)} className={cn(UI_INPUT, "text-sm")}>
                      {templates.options.map((template) => <option key={template.id} value={template.id}>{identityTemplateName(template, t)}</option>)}
                    </select>
                  </label>
                </div>
              )}
              {accountType === "customer" && templates.controls}
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
            {narrowingEditable && selectedTemplate?.permissions.includes("storage:manage-node") && <Notice tone="warning">{t("usersPerm.grants.bypassedByTemplate", { template: identityTemplateName(selectedTemplate, t) })}</Notice>}

            {narrowingEditable && <section data-inset className="p-4">
              <h4 className="ui-title-group">{t("usersPerm.section.servers")}</h4>
              <p className="mt-1 text-xs text-[var(--text-muted)]">{t("usersPerm.servers.hint")}</p>
              {servers.controls}
              <div className="mt-3 space-y-3">
                {servers.options.length === 0 && !servers.filtered ? <EmptyState>{t("usersPerm.servers.empty")}</EmptyState> :
                  servers.options.map((server) => {
                    const grant = serverGrantMap.get(server.id);
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
                            server, serverId: server.id,
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

            {narrowingEditable && !selectedTemplate?.permissions.includes("storage:manage-node") && <section data-inset className="p-4">
              <h4 className="ui-title-group">{t("usersPerm.section.grants")}</h4>
              <p className="mt-1 text-xs text-[var(--text-muted)]">{t("usersPerm.grants.hint")}</p>
              {nodes.controls}
              <div className="flex flex-wrap items-center gap-2">
                <select className={cn(UI_INPUT, "max-w-xs text-sm")} value={newNode?.id ?? ""} disabled={!newNode}
                  aria-label={t("usersPerm.grants.newNode")} onChange={event => setNewNodeId(event.target.value)}>
                  {nodes.options.map(node => <option key={node.id} value={node.id}>{node.name} · {getStorageDriverLabel(t, node.driver)}</option>)}
                </select>
                <ActionButton icon={<Plus size={16} aria-hidden />} size="sm" variant="success" disabled={!newNode} onClick={addGrant}>{t("usersPerm.action.addGrant")}</ActionButton>
              </div>
              <div className="mt-4 space-y-3">
                {grants.length === 0 ? <EmptyState>{t("usersPerm.grants.empty")}</EmptyState> : grants.map((grant, index) => {
                  const node = grant.storageNode;
                  const choices = nodesById.has(node.id) ? nodes.options : [node, ...nodes.options];
                  return (
                    <div key={`${grant.storageNodeId}-${index}`} data-card className="p-4">
                      <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr_1fr_1fr_auto]">
                        <label className="sr-only" htmlFor={`grantNode-${index}`}>{t("usersPerm.grants.node")}</label>
                        <select id={`grantNode-${index}`} value={grant.storageNodeId} onChange={(e) => {
                          const selected = nodesById.get(e.target.value);
                          if (selected) updateGrant(index, { storageNodeId: selected.id, storageNode: selected });
                        }} className={cn(UI_INPUT, "text-sm")}>
                          {choices.map((item) => <option key={item.id} value={item.id}>{item.name} · {getStorageDriverLabel(t, item.driver)}</option>)}
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

          </fieldset>
        )}
    </Dialog>
  );
}
