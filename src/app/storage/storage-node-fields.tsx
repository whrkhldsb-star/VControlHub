"use client";

import { useEffect, useId, useRef, useState } from "react";

import { CheckboxField, FormField, FormGrid } from "@/components/ui-primitives";
import { UI_INPUT } from "@/lib/ui/classes";
import { useI18n } from "@/lib/i18n/use-locale";
import { getStorageDriverLabel } from "@/lib/i18n/domain-labels";

export type StorageNodeFieldValues = {
  webdavConfig?: { url: string; authType: "basic" | "bearer"; username?: string; hasPassword?: boolean; hasToken?: boolean } | null;
  name?: string;
  basePath?: string;
  serverId?: string | null;
  host?: string | null;
  port?: number | null;
  username?: string | null;
  directAccessMode?: "PROXY" | "DIRECT" | "AUTO" | null;
  publicBaseUrl?: string | null;
  directAccessExpiresSeconds?: number | null;
  isDefault?: boolean;
};

export function StorageNodeFields({
  driver,
  onDriverChange,
  servers,
  values = {},
  includeExplicitUncheckedDefault = false,
  lockDefault = false,
}: {
  driver: string;
  onDriverChange: (driver: string) => void;
  servers: Array<{ id: string; name: string; host: string }>;
  values?: StorageNodeFieldValues;
  includeExplicitUncheckedDefault?: boolean;
  lockDefault?: boolean;
}) {
  const { t } = useI18n();
  // Each form gets ids of its own. The create form and every open edit form are on one page; with fixed ids a
  // label pointed at the first field of that name, which is in another form.
  const prefix = useId();
  const fid = (name: string) => `${prefix}-${name}`;
  const isSftp = driver === "SFTP";
  const [webdavAuthType, setWebdavAuthType] = useState(values.webdavConfig?.authType ?? "basic");
  const [davUrl, setDavUrl] = useState(values.webdavConfig?.url ?? "");
  const [davUsername, setDavUsername] = useState(values.webdavConfig?.username ?? "");
  const davIdentityChanged = davUrl.trim() !== (values.webdavConfig?.url ?? "") || webdavAuthType !== values.webdavConfig?.authType || (webdavAuthType === "basic" && davUsername.trim() !== (values.webdavConfig?.username ?? ""));
  const serverRef = useRef<HTMLSelectElement>(null);
  const hostRef = useRef<HTMLInputElement>(null);
  const eitherOrMessage = t("storagePage.form.sftpEndpointEitherOr");

  useEffect(() => {
    if (!isSftp) return;

    const syncValidity = () => {
      const serverEl = serverRef.current;
      const hostEl = hostRef.current;
      if (!serverEl || !hostEl) return;
      const hasEndpoint = Boolean(serverEl.value.trim() || hostEl.value.trim());
      const message = hasEndpoint ? "" : eitherOrMessage;
      serverEl.setCustomValidity(message);
      hostEl.setCustomValidity(message);
    };

    syncValidity();
    const serverEl = serverRef.current;
    const hostEl = hostRef.current;
    serverEl?.addEventListener("change", syncValidity);
    hostEl?.addEventListener("input", syncValidity);
    hostEl?.addEventListener("change", syncValidity);
    return () => {
      serverEl?.removeEventListener("change", syncValidity);
      hostEl?.removeEventListener("input", syncValidity);
      hostEl?.removeEventListener("change", syncValidity);
    };
  }, [eitherOrMessage, isSftp]);

  return (
    <FormGrid>
      <FormField label={t("storagePage.form.fieldName")} htmlFor={fid("storage-node-name")}>
        <input id={fid("storage-node-name")} name="name" defaultValue={values.name} required className={UI_INPUT} />
      </FormField>
      <FormField label={t("storagePage.form.fieldDriver")} htmlFor={fid("storage-node-driver")}>
        {lockDefault ? <input type="hidden" name="driver" value={driver} /> : null}
        <select id={fid("storage-node-driver")} name="driver" value={driver} className={UI_INPUT} disabled={lockDefault} onChange={(event) => onDriverChange(event.target.value)}>
          <option value="LOCAL">{getStorageDriverLabel(t, "LOCAL")}</option>
          <option value="SFTP">{getStorageDriverLabel(t, "SFTP")}</option>
          <option value="WEBDAV">{getStorageDriverLabel(t, "WEBDAV")}</option>
        </select>
      </FormField>
      <FormField label={t("storagePage.form.fieldBasePath")} htmlFor={fid("storage-node-base-path")} className="md:col-span-2">
        <input id={fid("storage-node-base-path")} name="basePath" defaultValue={values.basePath} required className={UI_INPUT} placeholder={t("storagePage.form.basePathPlaceholder")} />
      </FormField>

      {driver === "WEBDAV" ? <>
        <p className="md:col-span-2 text-xs text-[var(--text-muted)]">{t("storagePage.form.webdavHint")}</p>
        <input type="hidden" name="directAccessMode" value="PROXY" />
        <FormField label={t("storagePage.form.webdavUrl")} htmlFor={fid("storage-webdav-url")} className="md:col-span-2">
          <input id={fid("storage-webdav-url")} name="webdavUrl" type="url" pattern="https://.*" required value={davUrl} onChange={(event) => setDavUrl(event.target.value)} placeholder="https://dav.example.com/remote.php/dav/files/user/" className={UI_INPUT} />
        </FormField>
        <FormField label={t("storagePage.form.webdavAuthType")} htmlFor={fid("storage-webdav-auth")}>
          <select id={fid("storage-webdav-auth")} name="webdavAuthType" value={webdavAuthType} onChange={(event) => setWebdavAuthType(event.target.value as "basic" | "bearer")} className={UI_INPUT}>
            <option value="basic">{t("storagePage.form.webdavAuthBasic")}</option>
            <option value="bearer">{t("storagePage.form.webdavAuthBearer")}</option>
          </select>
        </FormField>
        {webdavAuthType === "basic" ? <>
          <FormField label={t("storagePage.form.webdavUsername")} htmlFor={fid("storage-webdav-username")}>
            <input id={fid("storage-webdav-username")} name="webdavUsername" value={davUsername} onChange={(event) => setDavUsername(event.target.value)} required autoComplete="off" className={UI_INPUT} />
          </FormField>
          <FormField label={t("storagePage.form.webdavPassword")} htmlFor={fid("storage-webdav-password")}>
            <input id={fid("storage-webdav-password")} name="webdavPassword" type="password" autoComplete="new-password" required={davIdentityChanged || !values.webdavConfig?.hasPassword} className={UI_INPUT} />
          </FormField>
        </> : <FormField label={t("storagePage.form.webdavToken")} htmlFor={fid("storage-webdav-token")}>
          <input id={fid("storage-webdav-token")} name="webdavToken" type="password" autoComplete="new-password" required={davIdentityChanged || !values.webdavConfig?.hasToken} className={UI_INPUT} />
        </FormField>}
        <p className="md:col-span-2 text-xs text-[var(--text-muted)]">{t("storagePage.form.webdavSecretHint")}</p>
      </> : null}

      {isSftp ? <>
        <p className="md:col-span-2 text-xs text-[var(--text-muted)]" data-testid="sftp-endpoint-hint">
          {t("storagePage.form.sftpEndpointHint")}
        </p>
        <FormField label={t("storagePage.form.fieldBindVps")} htmlFor={fid("storage-node-server")}>
          <select
            id={fid("storage-node-server")}
            name="serverId"
            ref={serverRef}
            defaultValue={values.serverId ?? ""}
            className={`${UI_INPUT} border-[var(--danger-border)]`}
          >
            <option value="">{t("storagePage.form.optionNotBound")}</option>
            {servers.map((server) => <option key={server.id} value={server.id}>{server.name} · {server.host}</option>)}
          </select>
        </FormField>
        <FormField label={t("storagePage.form.fieldRemoteHost")} htmlFor={fid("storage-node-host")}>
          <input
            id={fid("storage-node-host")}
            name="host"
            ref={hostRef}
            defaultValue={values.host ?? ""}
            className={`${UI_INPUT} border-[var(--danger-border)]`}
            placeholder={t("storagePage.form.hostPlaceholder")}
          />
        </FormField>
        <FormField label={t("storagePage.form.fieldPort")} htmlFor={fid("storage-node-port")}>
          <input id={fid("storage-node-port")} name="port" type="number" min={1} max={65535} defaultValue={values.port ?? 22} className={UI_INPUT} />
        </FormField>
        <FormField label={t("storagePage.form.fieldUsername")} htmlFor={fid("storage-node-username")}>
          <input id={fid("storage-node-username")} name="username" defaultValue={values.username ?? "root"} className={UI_INPUT} />
        </FormField>
        <FormField label={t("storagePage.form.fieldAccessMode")} htmlFor={fid("storage-node-access-mode")} className="md:col-span-2">
          <select id={fid("storage-node-access-mode")} name="directAccessMode" defaultValue={values.directAccessMode ?? "PROXY"} className={UI_INPUT}>
            <option value="PROXY">{t("storagePage.form.accessModeProxy")}</option>
            <option value="DIRECT">{t("storagePage.form.accessModeDirect")}</option>
            <option value="AUTO">{t("storagePage.form.accessModeAuto")}</option>
          </select>
        </FormField>
        <FormField label={t("storagePage.form.fieldPublicBaseUrl")} htmlFor={fid("storage-node-public-url")}>
          <input id={fid("storage-node-public-url")} name="publicBaseUrl" type="url" defaultValue={values.publicBaseUrl ?? ""} className={UI_INPUT} placeholder={t("storagePage.form.publicBaseUrlPlaceholder")} />
        </FormField>
        <FormField label={t("storagePage.form.fieldDirectExpiresSeconds")} htmlFor={fid("storage-node-expires")}>
          <input id={fid("storage-node-expires")} name="directAccessExpiresSeconds" type="number" min={60} max={86400} defaultValue={values.directAccessExpiresSeconds ?? 300} className={UI_INPUT} />
        </FormField>
      </> : null}

      <div className="md:col-span-2">
        {includeExplicitUncheckedDefault && !lockDefault ? <input type="hidden" name="isDefault" value="off" /> : null}
        {lockDefault ? <input type="hidden" name="isDefault" value="on" /> : null}
        <CheckboxField name="isDefault" value="on" defaultChecked={values.isDefault} disabled={lockDefault} label={t("storagePage.form.fieldIsDefault")} />
        {lockDefault ? <p className="mt-2 text-xs text-[var(--text-muted)]">{t("storagePage.form.defaultLockedHint")}</p> : null}
      </div>
    </FormGrid>
  );
}
