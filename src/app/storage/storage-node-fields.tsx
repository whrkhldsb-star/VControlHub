"use client";

import { CheckboxField, FormField, FormGrid } from "@/components/ui-primitives";
import { UI_INPUT } from "@/lib/ui/classes";
import { useI18n } from "@/lib/i18n/use-locale";

export type StorageNodeFieldValues = {
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
}: {
  driver: string;
  onDriverChange: (driver: string) => void;
  servers: Array<{ id: string; name: string; host: string }>;
  values?: StorageNodeFieldValues;
  includeExplicitUncheckedDefault?: boolean;
}) {
  const { t } = useI18n();
  const isSftp = driver === "SFTP";
  const required = <span className="text-[var(--danger)]">{t("storagePage.form.fieldBindVpsRequired")}</span>;

  return (
    <FormGrid>
      <FormField label={t("storagePage.form.fieldName")} htmlFor="storage-node-name">
        <input id="storage-node-name" name="name" defaultValue={values.name} required className={UI_INPUT} />
      </FormField>
      <FormField label={t("storagePage.form.fieldDriver")} htmlFor="storage-node-driver">
        <select id="storage-node-driver" name="driver" value={driver} className={UI_INPUT} onChange={(event) => onDriverChange(event.target.value)}>
          <option value="LOCAL">LOCAL</option>
          <option value="SFTP">SFTP</option>
        </select>
      </FormField>
      <FormField label={t("storagePage.form.fieldBasePath")} htmlFor="storage-node-base-path" className="md:col-span-2">
        <input id="storage-node-base-path" name="basePath" defaultValue={values.basePath} required className={UI_INPUT} placeholder={t("storagePage.form.basePathPlaceholder")} />
      </FormField>

      {isSftp ? <>
        <FormField label={<>{t("storagePage.form.fieldBindVps")} {required}</>} htmlFor="storage-node-server">
          <select id="storage-node-server" name="serverId" defaultValue={values.serverId ?? ""} required className={`${UI_INPUT} border-[var(--danger-border)]`}>
            <option value="">{t("storagePage.form.optionNotBound")}</option>
            {servers.map((server) => <option key={server.id} value={server.id}>{server.name} · {server.host}</option>)}
          </select>
        </FormField>
        <FormField label={<>{t("storagePage.form.fieldRemoteHost")} {required}</>} htmlFor="storage-node-host">
          <input id="storage-node-host" name="host" defaultValue={values.host ?? ""} required className={`${UI_INPUT} border-[var(--danger-border)]`} placeholder={t("storagePage.form.hostPlaceholder")} />
        </FormField>
        <FormField label={t("storagePage.form.fieldPort")} htmlFor="storage-node-port">
          <input id="storage-node-port" name="port" type="number" min={1} max={65535} defaultValue={values.port ?? 22} className={UI_INPUT} />
        </FormField>
        <FormField label={t("storagePage.form.fieldUsername")} htmlFor="storage-node-username">
          <input id="storage-node-username" name="username" defaultValue={values.username ?? "root"} className={UI_INPUT} />
        </FormField>
        <FormField label={t("storagePage.form.fieldAccessMode")} htmlFor="storage-node-access-mode" className="md:col-span-2">
          <select id="storage-node-access-mode" name="directAccessMode" defaultValue={values.directAccessMode ?? "PROXY"} className={UI_INPUT}>
            <option value="PROXY">{t("storagePage.form.accessModeProxy")}</option>
            <option value="DIRECT">{t("storagePage.form.accessModeDirect")}</option>
            <option value="AUTO">{t("storagePage.form.accessModeAuto")}</option>
          </select>
        </FormField>
        <FormField label={t("storagePage.form.fieldPublicBaseUrl")} htmlFor="storage-node-public-url">
          <input id="storage-node-public-url" name="publicBaseUrl" type="url" defaultValue={values.publicBaseUrl ?? ""} className={UI_INPUT} placeholder={t("storagePage.form.publicBaseUrlPlaceholder")} />
        </FormField>
        <FormField label={t("storagePage.form.fieldDirectExpiresSeconds")} htmlFor="storage-node-expires">
          <input id="storage-node-expires" name="directAccessExpiresSeconds" type="number" min={60} max={86400} defaultValue={values.directAccessExpiresSeconds ?? 300} className={UI_INPUT} />
        </FormField>
      </> : null}

      <div className="md:col-span-2">
        {includeExplicitUncheckedDefault ? <input type="hidden" name="isDefault" value="off" /> : null}
        <CheckboxField name="isDefault" value="on" defaultChecked={values.isDefault} label={t("storagePage.form.fieldIsDefault")} />
      </div>
    </FormGrid>
  );
}
