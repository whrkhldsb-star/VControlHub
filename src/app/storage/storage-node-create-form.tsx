"use client";

import { useActionState, useState } from "react";

import { SubmitButton } from "@/components/submit-button";
import { useI18n } from "@/lib/i18n/use-locale";

import { createStorageNodeAction, type StorageActionState } from "./actions";

const initialState: StorageActionState = {};

export function StorageNodeCreateForm({
  servers,
}: {
  servers: Array<{ id: string; name: string; host: string }>;
}) {
  const { t } = useI18n();
  const [state, formAction] = useActionState(createStorageNodeAction, initialState);
  const [driver, setDriver] = useState<string>("LOCAL");

  const isSftp = driver === "SFTP";

  return (
    <form action={formAction} className="grid gap-4 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <div>
        <h2 className="text-xl font-semibold text-[var(--text-primary)]">{t("storagePage.form.createTitle")}</h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">{t("storagePage.form.createDescription")}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-2 text-sm text-[var(--text-secondary)]">
          <span>{t("storagePage.form.fieldName")}</span>
          <input name="name" required className="rounded-2xl border border-[var(--border)] bg-[var(--input-bg)] px-4 py-3 text-[var(--text-primary)]" />
        </label>
        <label className="grid gap-2 text-sm text-[var(--text-secondary)]">
          <span>{t("storagePage.form.fieldDriver")}</span>
          <select
            name="driver"
            defaultValue="LOCAL"
            className="rounded-2xl border border-[var(--border)] bg-[var(--input-bg)] px-4 py-3 text-[var(--text-primary)]"
            onChange={(e) => setDriver(e.target.value)}
          >
            <option value="LOCAL">LOCAL</option>
            <option value="SFTP">SFTP</option>
          </select>
        </label>
        <label className="grid gap-2 text-sm text-[var(--text-secondary)] md:col-span-2">
          <span>{t("storagePage.form.fieldBasePath")}</span>
          <input name="basePath" required className="rounded-2xl border border-[var(--border)] bg-[var(--input-bg)] px-4 py-3 text-[var(--text-primary)]" placeholder={t("storagePage.form.basePathPlaceholder")} />
        </label>
        {isSftp ? (
          <>
            <label className="grid gap-2 text-sm text-[var(--text-secondary)]">
              <span>{t("storagePage.form.fieldBindVps")} <span className="text-rose-400">{t("storagePage.form.fieldBindVpsRequired")}</span></span>
              <select name="serverId" className="rounded-2xl border border-rose-400/40 bg-[var(--input-bg)] px-4 py-3 text-[var(--text-primary)]">
                <option value="">{t("storagePage.form.optionNotBound")}</option>
                {servers.map((server) => (
                  <option key={server.id} value={server.id}>{server.name} · {server.host}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm text-[var(--text-secondary)]">
              <span>{t("storagePage.form.fieldRemoteHost")} <span className="text-rose-400">{t("storagePage.form.fieldRemoteHostRequired")}</span></span>
              <input name="host" className="rounded-2xl border border-rose-400/40 bg-[var(--input-bg)] px-4 py-3 text-[var(--text-primary)]" placeholder={t("storagePage.form.hostPlaceholder")} />
            </label>
            <label className="grid gap-2 text-sm text-[var(--text-secondary)]">
              <span>{t("storagePage.form.fieldPort")}</span>
              <input name="port" type="number" min={1} max={65535} defaultValue={22} className="rounded-2xl border border-[var(--border)] bg-[var(--input-bg)] px-4 py-3 text-[var(--text-primary)]" />
            </label>
            <label className="grid gap-2 text-sm text-[var(--text-secondary)]">
              <span>{t("storagePage.form.fieldUsername")}</span>
              <input name="username" defaultValue="root" className="rounded-2xl border border-[var(--border)] bg-[var(--input-bg)] px-4 py-3 text-[var(--text-primary)]" />
            </label>
            <label className="grid gap-2 text-sm text-[var(--text-secondary)] md:col-span-2">
              <span>{t("storagePage.form.fieldAccessMode")}</span>
              <select name="directAccessMode" defaultValue="PROXY" className="rounded-2xl border border-[var(--border)] bg-[var(--input-bg)] px-4 py-3 text-[var(--text-primary)]">
                <option value="PROXY">{t("storagePage.form.accessModeProxy")}</option>
                <option value="DIRECT">{t("storagePage.form.accessModeDirect")}</option>
                <option value="AUTO">{t("storagePage.form.accessModeAuto")}</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm text-[var(--text-secondary)]">
              <span>{t("storagePage.form.fieldPublicBaseUrl")}</span>
              <input name="publicBaseUrl" type="url" className="rounded-2xl border border-[var(--border)] bg-[var(--input-bg)] px-4 py-3 text-[var(--text-primary)]" placeholder={t("storagePage.form.publicBaseUrlPlaceholder")} />
            </label>
            <label className="grid gap-2 text-sm text-[var(--text-secondary)]">
              <span>{t("storagePage.form.fieldDirectExpiresSeconds")}</span>
              <input name="directAccessExpiresSeconds" type="number" min={60} max={86400} defaultValue={300} className="rounded-2xl border border-[var(--border)] bg-[var(--input-bg)] px-4 py-3 text-[var(--text-primary)]" />
            </label>
          </>
        ) : null}
        <label className="flex items-center gap-3 text-sm text-[var(--text-secondary)] md:col-span-2">
          <input name="isDefault" type="checkbox" className="h-4 w-4" />
          {t("storagePage.form.fieldIsDefault")}
        </label>
      </div>

      {state.error ? <div data-tone="rose" className="rounded-2xl border border-rose-400/30 px-4 py-3 text-sm text-rose-100">{state.error}</div> : null}
      {state.success ? <div data-tone="emerald" className="rounded-2xl border border-emerald-400/30 px-4 py-3 text-sm text-emerald-100">{state.success}</div> : null}

      <div className="flex justify-end"><SubmitButton pendingLabel={t("storagePage.form.submitPending")}>{t("storagePage.form.submitCreate")}</SubmitButton></div>
    </form>
  );
}
