"use client";

import { useEffect, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { useI18n } from "@/lib/i18n/use-locale";
import type { ServerActionState } from "./actions";

import { UI_INPUT } from "@/lib/ui/classes";
import { usePreservedActionForm } from "@/lib/forms/use-preserved-action-form";
import { ServerManagementModeFields } from "./server-management-mode-fields";
import { RdpCredentialFields } from "./rdp-credential-fields";
import { WindowsSftpFields } from "./windows-sftp-fields";
import { Notice, SegmentedControl } from "@/components/ui-primitives";
import { useSshKeyOptions } from "./ssh-key-options";
import { billingFormValues, type ServerBillingDto } from "@/lib/server/billing-form";
import { ServerBillingFields } from "./server-billing-fields";
type Props = {
  operatingSystem?: string; rdpDomain?: string; rdpIgnoreCertificate?: boolean; rdpCertificateSha256?: string;
  serverId: string;
  serverName: string;
  host: string;
  port: number;
  username: string;
  connectionType: "SSH_KEY" | "PASSWORD";
  /** The key the node uses now (connectionType SSH_KEY). */
  sshKeyId?: string | null;
  managementMode?: "DIRECT" | "AGENT";
  hasSshCredential?: boolean;
  description: string | null | undefined;
  tags: string[] | null | undefined;
  costAutoSync: boolean;
  costMonthlyAmount: string | null | undefined;
  costCurrency: "CNY" | "USD" | "EUR" | "JPY" | "HKD";
  costProvider: string | null | undefined;
  costLastSyncedAt: string | null | undefined;
  billing?: ServerBillingDto | null;
  storagePath?: string | null;
  storageNodeId?: string | null;
  windowsSftpPort?: number;
  windowsSftpUsername?: string;
  // form action from useActionState
  editAction: (formData: FormData) => void | Promise<void>;
  editState: ServerActionState;
};

export function ServerCardEditForm({
  operatingSystem = "LINUX", rdpDomain, rdpIgnoreCertificate, rdpCertificateSha256,
  serverId,
  serverName,
  host,
  port,
  username,
  connectionType,
  sshKeyId = null,
  managementMode = "DIRECT",
  hasSshCredential = true,
  description,
  tags,
  costAutoSync,
  costMonthlyAmount,
  costCurrency,
  costProvider,
  costLastSyncedAt,
  billing,
  storagePath = null,
  storageNodeId = null,
  windowsSftpPort = 22,
  windowsSftpUsername = "",
  editAction,
  editState,
}: Props) {
  const { t } = useI18n();
  const windows = operatingSystem === "WINDOWS";
  const [observedHostKeySha256, setObservedHostKeySha256] = useState(
    () => editState.hostKeySha256 ?? "",
  );
  const [hostKeyConfirmed, setHostKeyConfirmed] = useState(false);
  const [selectedManagementMode, setSelectedManagementMode] = useState(managementMode);
  const [selectedConnectionType, setSelectedConnectionType] = useState(connectionType);
  // Windows: another account needs its own password — the stored one belongs
  // to the account the node used before.
  const [rdpAccountChanged, setRdpAccountChanged] = useState(false);
  const sshKeys = useSshKeyOptions();
  // Switching the login type keeps nothing of the old credential (also under
  // Agent mode, where saving without one would drop it): the new one is required.
  const credentialRequired = selectedConnectionType !== connectionType || (selectedManagementMode === "DIRECT" && !hasSshCredential);
  const { formRef, captureBeforeSubmit } = usePreservedActionForm(
    editState,
    Boolean(editState.error),
  );
  useEffect(() => {
    if (editState.hostKeySha256) {
      setObservedHostKeySha256(editState.hostKeySha256);
      setHostKeyConfirmed(false);
    } else if (editState.error || editState.success) {
      setObservedHostKeySha256("");
      setHostKeyConfirmed(false);
    }
  }, [editState.error, editState.hostKeySha256, editState.success]);

  return (
    <form
      ref={formRef}
      action={editAction}
      onSubmit={captureBeforeSubmit}
      aria-label={t("serverCardActions.edit.formAria")}
      data-tile className="space-y-3 p-3"
      onChange={(event) => {
        const field = event.target;
        if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) return;
        if (windows && (field.name === "username" || field.name === "rdpDomain")) {
          const value = (name: string) => ((field.form?.elements.namedItem(name) as HTMLInputElement | null)?.value ?? "").trim();
          setRdpAccountChanged(value("username").toLowerCase() !== username.trim().toLowerCase() || value("rdpDomain").toLowerCase() !== (rdpDomain ?? "").trim().toLowerCase());
        }
        if (["host", "port", "username", "password", "sshKeyId", "windowsSftpPort", "windowsSftpUsername", "windowsSftpPassword"].includes(field.name)) {
          setObservedHostKeySha256("");
          setHostKeyConfirmed(false);
        }
      }}
    >
      <input type="hidden" name="serverId" value={serverId} />
      <input type="hidden" name="operatingSystem" value={operatingSystem} />
      <p className="text-xs text-[var(--text-muted)]">{t("serversPage.windows.os")}: {windows ? "Windows" : "Linux"}</p>
      <input type="hidden" name="connectionType" value={windows ? connectionType : selectedConnectionType} />
      <ServerManagementModeFields
        defaultValue={managementMode}
        onChange={setSelectedManagementMode}
        platform={windows ? "WINDOWS" : "LINUX"}
      />
      {!windows && selectedManagementMode === "AGENT" && hasSshCredential ? (
        <label data-inset="" className="flex items-start gap-2 border-[var(--warning-border)] p-3 text-xs text-[var(--text-secondary)]">
          <input name="removeSshCredential" type="checkbox" className="mt-0.5 h-4 w-4" />
          <span><span className="block font-medium text-[var(--text-primary)]">{t("serversPage.management.removeCredential")}</span><span className="mt-1 block text-[var(--text-muted)]">{t("serversPage.management.removeCredentialHint")}</span></span>
        </label>
      ) : null}
      <label className="ui-label block" htmlFor={`edit-name-${serverId}`}>
        {t("serverCardActions.edit.name")}
      </label>
      <input
        id={`edit-name-${serverId}`}
        name="name"
        type="text"
        defaultValue={serverName}
        className={UI_INPUT}
      />
      <label className="ui-label block" htmlFor={`edit-host-${serverId}`}>
        {t("serverCardActions.edit.host")}
      </label>
      <input
        id={`edit-host-${serverId}`}
        name="host"
        type="text"
        defaultValue={host}
        className={UI_INPUT}
      />
      <label className="ui-label block" htmlFor={`edit-port-${serverId}`}>
        {t(windows ? "serversPage.windows.port" : "serverCardActions.edit.port")}
      </label>
      <input
        id={`edit-port-${serverId}`}
        name="port"
        type="number"
        min={1}
        max={65535}
        defaultValue={port}
        className={UI_INPUT}
      />
      <label className="ui-label block" htmlFor={`edit-username-${serverId}`}>
        {t(windows ? "serversPage.windows.username" : "serverCardActions.edit.username")}
      </label>
      <input
        id={`edit-username-${serverId}`}
        name="username"
        type="text"
        defaultValue={username}
        className={UI_INPUT}
      />
      {windows ? <><RdpCredentialFields idPrefix={`edit-rdp-${serverId}`} editing passwordRequired={rdpAccountChanged} certificateSha256={rdpCertificateSha256} domain={rdpDomain} ignoreCertificate={rdpIgnoreCertificate} />
      <WindowsSftpFields editing configured={Boolean(storageNodeId)} port={windowsSftpPort} username={windowsSftpUsername} basePath={storagePath ?? "/C:/VControlHub/Files"} />
      {observedHostKeySha256 ? <Notice tone="warning" role="group" compact>
        <p className="font-medium text-[var(--text-primary)]">{t("serverCardActions.edit.hostKeyTrustTitle")}</p>
        <code className="mt-2 block break-all">{observedHostKeySha256}</code>
        <input type="hidden" name="approvedHostKeySha256" value={observedHostKeySha256} />
        <label className="mt-2 flex items-start gap-2"><input type="checkbox" required checked={hostKeyConfirmed} onChange={(event) => setHostKeyConfirmed(event.currentTarget.checked)} />{t("serverCardActions.edit.hostKeyConfirm")}</label>
      </Notice> : null}</> : <>
      <Notice tone="warning" role="group" compact>
        <span className="block font-medium text-[var(--text-primary)]">
          {t("serverCardActions.edit.hostKeyTrustTitle")}
        </span>
        <span className="block text-xs text-[var(--text-muted)]">
          {t("serverCardActions.edit.hostKeyTrustDesc")}
        </span>
        {observedHostKeySha256 ? (
          <>
            <span className="font-medium text-[var(--warning)]">{t("serverCardActions.edit.hostKeyObserved")}</span>
            <code data-inset="" className="block break-all border-[var(--warning-border)] px-3 py-2 text-[var(--text-primary)]">
              {observedHostKeySha256}
            </code>
            <input type="hidden" name="approvedHostKeySha256" value={observedHostKeySha256} />
            <label className="flex items-start gap-2 text-[var(--text-primary)]">
              <input
                type="checkbox"
                required
                checked={hostKeyConfirmed}
                onChange={(event) => setHostKeyConfirmed(event.currentTarget.checked)}
                className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
              />
              <span>{t("serverCardActions.edit.hostKeyConfirm")}</span>
            </label>
          </>
        ) : null}
      </Notice>
      <div className="space-y-1.5">
        <span className="ui-label block">{t("serversPage.create.connectionType")}</span>
        <SegmentedControl
          block
          ariaLabel={t("serversPage.create.connectionType")}
          value={selectedConnectionType}
          onChange={(value) => {
            setSelectedConnectionType(value);
            setObservedHostKeySha256("");
            setHostKeyConfirmed(false);
          }}
          options={[
            { value: "SSH_KEY", label: t("serversPage.create.sshKey") },
            { value: "PASSWORD", label: t("serversPage.create.password") },
          ]}
        />
      </div>
      {selectedConnectionType === "SSH_KEY" ? (
        <>
          <label className="ui-label block" htmlFor={`edit-ssh-key-${serverId}`}>
            {t("serversPage.create.sshKey")}
          </label>
          <select
            id={`edit-ssh-key-${serverId}`}
            name="sshKeyId"
            defaultValue={connectionType === "SSH_KEY" ? sshKeyId ?? "" : ""}
            required={credentialRequired || selectedManagementMode === "DIRECT"}
            className={UI_INPUT}
          >
            <option value="">{t("serversPage.create.selectKey")}</option>
            {sshKeys.map((key) => (
              <option key={key.id} value={key.id}>{key.name}</option>
            ))}
            {/* A key outside this account's library (e.g. another customer's) stays selectable as is. */}
            {connectionType === "SSH_KEY" && sshKeyId && !sshKeys.some((key) => key.id === sshKeyId) ? (
              <option value={sshKeyId}>{t("serverCardActions.edit.currentKey")}</option>
            ) : null}
          </select>
          <p className="text-xs text-[var(--text-muted)]">{t("serverCardActions.edit.sshKeyHint")}</p>
        </>
      ) : (
        <>
          <label className="ui-label block" htmlFor={`edit-password-${serverId}`}>
            {t(credentialRequired ? "serversPage.create.password" : "serverCardActions.edit.password")}
          </label>
          <input
            key={credentialRequired ? "password-required" : "password-optional"}
            id={`edit-password-${serverId}`}
            name="password"
            type="password"
            defaultValue=""
            autoComplete="new-password"
            required={credentialRequired}
            className={UI_INPUT}
          />
        </>
      )}
      </>}
      <label className="ui-label block" htmlFor={`edit-description-${serverId}`}>
        {t("serverCardActions.edit.description")}
      </label>
      <textarea
        id={`edit-description-${serverId}`}
        name="description"
        defaultValue={description ?? ""}
        rows={2}
        className={UI_INPUT}
      />
      <label className="ui-label block" htmlFor={`edit-tags-${serverId}`}>
        {t("serverCardActions.edit.tags")}
      </label>
      <input
        id={`edit-tags-${serverId}`}
        name="tags"
        type="text"
        defaultValue={(tags ?? []).join(",")}
        className={UI_INPUT}
      />
      {!windows && storageNodeId ? (
        <div data-inset className="space-y-2 p-3">
          <label className="ui-label block" htmlFor={`edit-storage-path-${serverId}`}>
            {t("serverCardActions.edit.storagePath")}
          </label>
          <input
            id={`edit-storage-path-${serverId}`}
            name="storagePath"
            type="text"
            defaultValue={storagePath ?? "/root/drive"}
            placeholder="/root/drive"
            className={UI_INPUT}
          />
          <p className="text-xs leading-5 text-[var(--text-muted)]">
            {t("serverCardActions.edit.storagePathHint")}
          </p>
          <label className="flex items-start gap-2 text-xs text-[var(--text-secondary)]">
            <input
              name="repairStoragePath"
              type="checkbox"
              defaultChecked
              className="mt-0.5 h-4 w-4 rounded border-[var(--border)] bg-[var(--input-bg)]"
            />
            <span>{t("serverCardActions.edit.repairStoragePath")}</span>
          </label>
        </div>
      ) : null}
      <div data-inset className="space-y-2 p-3">
        <label className="flex items-start gap-2 text-xs text-[var(--text-secondary)]">
          <input
            name="costAutoSync"
            type="checkbox"
            defaultChecked={costAutoSync}
            className="mt-0.5 h-4 w-4 rounded border-[var(--border)] bg-[var(--input-bg)]"
          />
          <span>
            <span className="block font-medium text-[var(--text-primary)]">
              {t("serverCardActions.edit.costAutoSync")}
            </span>
            <span className="text-xs text-[var(--text-muted)]">
              {t("serverCardActions.edit.costHint")}
            </span>
          </span>
        </label>
        <div className="grid gap-2 sm:grid-cols-[1fr_90px]">
          <input
            name="costMonthlyAmount"
            type="text"
            inputMode="decimal"
            defaultValue={costMonthlyAmount ?? ""}
            placeholder="0.00"
            className={UI_INPUT}
            aria-label={t("serverCardActions.edit.costMonthlyAmount")}
          />
          <select
            name="costCurrency"
            defaultValue={costCurrency}
            className={UI_INPUT}
            aria-label={t("serverCardActions.edit.costCurrency")}
          >
            {(["CNY", "USD", "EUR", "JPY", "HKD"] as const).map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </select>
        </div>
        <input
          name="costProvider"
          type="text"
          defaultValue={costProvider ?? ""}
          placeholder={t("serverCardActions.edit.costProviderPlaceholder")}
          className={UI_INPUT}
          aria-label={t("serverCardActions.edit.costProvider")}
        />
        {costLastSyncedAt ? (
          <p className="text-xs text-[var(--text-muted)]">
            {t("serverCardActions.edit.costLastSynced", { time: costLastSyncedAt })}
          </p>
        ) : null}
        <ServerBillingFields compact defaults={billingFormValues(billing)} />
      </div>
      <SubmitButton pendingLabel={t("serverCardActions.edit.pending")} variant="success" className="w-full">
        {t(observedHostKeySha256 ? "serverCardActions.edit.submitConfirmed" : "serverCardActions.edit.submit")}
      </SubmitButton>
      {editState.error && !observedHostKeySha256 ? (
        <div role="alert" className="text-xs text-[var(--danger)]">
          {editState.error}
        </div>
      ) : null}
      {editState.success ? (
        <div role="status" className="text-xs text-[var(--success)]">
          {editState.success}
        </div>
      ) : null}
    </form>
  );
}
