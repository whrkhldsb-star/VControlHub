"use client";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SubmitButton } from "@/components/submit-button";
import { createServerAction, type ServerActionState } from "./actions";
import { ConnectionTypeFields } from "./server-connection-type-fields";
import { ServerManagementModeFields } from "./server-management-mode-fields";
import { ServerCostFields } from "./server-cost-fields";
import { useI18n } from "@/lib/i18n/use-locale";
import { UI_INPUT } from "@/lib/ui/classes";
import { RdpCredentialFields } from "./rdp-credential-fields";
import { Notice } from "@/components/ui-primitives";
import { usePreservedActionForm } from "@/lib/forms/use-preserved-action-form";
import { useUnsavedChangesGuard } from "@/lib/forms/use-unsaved-changes-guard";
const initialState: ServerActionState = {
  error: undefined,
  success: undefined,
  relatedStorageCount: undefined,
};
export function ServerCreateForm({
  sshKeys,
}: {
  sshKeys: Array<{
    id: string;
    name: string;
    fingerprint: string;
    description: string | null;
  }>;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [operatingSystem, setOperatingSystem] = useState("LINUX");
  const windows = operatingSystem === "WINDOWS";
  const [state, formAction] = useActionState(createServerAction, initialState);
  const [observedHostKeySha256, setObservedHostKeySha256] = useState(
    () => state.hostKeySha256 ?? "",
  );
  const [hostKeyConfirmed, setHostKeyConfirmed] = useState(false);
  const [dirty, setDirty] = useState(false);
  const { discardDialog } = useUnsavedChangesGuard({ dirty });
  const { formRef, captureBeforeSubmit } = usePreservedActionForm(
    state,
    Boolean(state.error),
  );
  useEffect(() => {
    if (state.hostKeySha256) {
      setObservedHostKeySha256(state.hostKeySha256);
      setHostKeyConfirmed(false);
    } else if (state.error || state.success) {
      setObservedHostKeySha256("");
      setHostKeyConfirmed(false);
    }
  }, [state.error, state.hostKeySha256, state.success]);
  useEffect(() => {
    if (state.success) {
      setDirty(false); router.refresh();
  }
  }, [state.success, router]);
  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={captureBeforeSubmit}
      data-card
      className="grid gap-4"
      onChange={(event) => {
        setDirty(true);
        const field = event.target;
        if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) return;
        if (["host", "port", "username", "connectionType", "sshKeyId", "password"].includes(field.name)) {
          setObservedHostKeySha256("");
          setHostKeyConfirmed(false);
        }
      }}
    >
      {" "}
      <div>
        {" "}
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          {t("serversPage.create.title")}
        </h2>{" "}
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          {t(windows ? "serversPage.windows.hint" : "serversPage.create.desc")}
        </p>{" "}
      </div>{" "}
      {state.error && !observedHostKeySha256 && (
        <Notice tone="danger">{state.error}</Notice>
      )}{" "}
      {state.success && (
        <div role="status" className="rounded-lg bg-[var(--success-bg)] border border-[var(--success-border)] px-3.5 py-2.5 text-sm text-[var(--success)]">
          {" "}
          {state.success}{" "}
        </div>
      )}{" "}
      <label htmlFor="serverOperatingSystem">{t("serversPage.windows.os")}</label>
      <select id="serverOperatingSystem" name="operatingSystem" className={UI_INPUT} value={operatingSystem} onChange={(event) => { setOperatingSystem(event.target.value); setObservedHostKeySha256(""); setHostKeyConfirmed(false); }}>
        <option value="LINUX">Linux</option><option value="WINDOWS">Windows</option>
      </select>
      <div className="grid gap-3 sm:grid-cols-2">
        {" "}
        <div className="space-y-1.5">
          {" "}
          <label
            className="text-xs font-medium text-[var(--text-primary)]/70 "
            htmlFor="serverName"
          >
            {t("serversPage.create.name")}
          </label>{" "}
          <input
            id="serverName"
            name="name"
            type="text"
            required
            placeholder={t("serversPage.create.namePlaceholder")}
            className={UI_INPUT}
          />{" "}
        </div>{" "}
        <div className="space-y-1.5">
          {" "}
          <label
            className="text-xs font-medium text-[var(--text-primary)]/70 "
            htmlFor="serverDesc"
          >
            {t("serversPage.create.description")}
          </label>{" "}
          <input
            id="serverDesc"
            name="description"
            type="text"
            placeholder={t("serversPage.create.descriptionPlaceholder")}
            className={UI_INPUT}
          />{" "}
        </div>{" "}
      </div>{" "}
      <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
        {" "}
        <div className="space-y-1.5">
          {" "}
          <label
            className="text-xs font-medium text-[var(--text-primary)]/70 "
            htmlFor="serverHost"
          >
            {t("serversPage.create.host")}
          </label>{" "}
          <input
            id="serverHost"
            name="host"
            type="text"
            required
            placeholder="1.2.3.4"
            className={UI_INPUT}
          />{" "}
        </div>{" "}
        <div className="space-y-1.5">
          {" "}
          <label
            className="text-xs font-medium text-[var(--text-primary)]/70 "
            htmlFor="serverPort"
          >
            {t(windows ? "serversPage.windows.port" : "serversPage.create.port")}
          </label>{" "}
          <input
            id="serverPort"
            name="port"
            type="number"
            key={operatingSystem}
            defaultValue={windows ? 3389 : 22}
            min={1}
            max={65535}
            className={UI_INPUT}
          />{" "}
        </div>{" "}
      </div>{" "}
      {windows ? <>
      <ServerManagementModeFields platform="WINDOWS" />
      <RdpCredentialFields idPrefix="create-rdp" />
      <ServerCostFields />
      </> : <>
      <ServerCostFields />
      <ServerManagementModeFields />
      <ConnectionTypeFields sshKeys={sshKeys} />{" "}
      <div className="rounded-xl border border-[var(--warning-border)] bg-[var(--warning-bg)] p-4 text-sm text-[var(--text-secondary)]">
        <div className="space-y-2">
          <span className="block font-medium text-[var(--text-primary)]">
            {t("serversPage.create.hostKeyTrustTitle")}
          </span>
          <span className="block text-xs text-[var(--text-secondary)]">
            {t("serversPage.create.hostKeyTrustDesc")}
          </span>
          {observedHostKeySha256 ? (
            <>
              <span className="block text-xs font-medium text-[var(--warning)]">
                {t("serversPage.create.hostKeyObserved")}
              </span>
              <code className="block break-all rounded-lg border border-[var(--warning-border)] bg-[var(--input-bg)] px-3 py-2 text-xs text-[var(--text-primary)]">
                {observedHostKeySha256}
              </code>
              <input type="hidden" name="approvedHostKeySha256" value={observedHostKeySha256} />
              <label className="flex items-start gap-2 text-xs text-[var(--text-primary)]">
                <input
                  type="checkbox"
                  required
                  checked={hostKeyConfirmed}
                  onChange={(event) => setHostKeyConfirmed(event.currentTarget.checked)}
                  className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                />
                <span>{t("serversPage.create.hostKeyConfirm")}</span>
              </label>
            </>
          ) : null}
          <span className="block text-xs text-[var(--warning)]">
            {t("serversPage.create.hostKeyTrustHint")}
          </span>
        </div>
      </div>{" "}
      <details className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
        <summary className="cursor-pointer text-sm font-medium text-[var(--text-primary)]">
          {t("serversPage.create.advancedTitle")}
        </summary>
        <div className="mt-4 space-y-4">
      <div className="space-y-1.5">
        {" "}
        <label
          className="text-xs font-medium text-[var(--text-primary)]/70 "
          htmlFor="serverStoragePath"
        >
          {t("serversPage.create.storagePath")}
        </label>{" "}
        <input
          id="serverStoragePath"
          name="storagePath"
          type="text"
          defaultValue={t("serversPage.create.storagePathDefault")}
          placeholder="/root/drive"
          className={UI_INPUT}
        />{" "}
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          {" "}
          {t("serversPage.create.storagePathDesc").replace(
            "{path}",
            "/root/drive",
          )}{" "}
        </p>{" "}
      </div>{" "}
      <label
        data-tone="cyan"
        className="rounded-xl border border-[var(--color-action-border)]/20 p-4 text-sm text-[var(--text-secondary)]"
      >
        {" "}
        <div className="flex items-start gap-3">
          {" "}
          <input
            name="enableDirectGateway"
            type="checkbox"
            className="mt-1 h-4 w-4 rounded-lg border-[var(--color-action-border)]/40 bg-[var(--input-bg)]"
          />{" "}
          <div>
            {" "}
            <div className="font-medium text-[var(--text-primary)]">
              {t("serversPage.create.directGateway.title")}
            </div>{" "}
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              {t("serversPage.create.directGateway.desc")}
            </p>{" "}
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {" "}
              {t("serversPage.create.directGateway.note")}{" "}
            </p>{" "}
            <label
              className="mt-3 block text-xs font-medium text-[var(--text-primary)]/70"
              htmlFor="directGatewayProtocol"
            >
              {" "}
              {t("serversPage.create.directGateway.protocol")}{" "}
            </label>{" "}
            <select
              id="directGatewayProtocol"
              name="directGatewayProtocol"
              defaultValue="http"
              className="mt-1 w-full rounded-lg border border-[var(--color-action-border)]/20 bg-[var(--surface-subtle)] px-3 py-2 text-xs text-[var(--text-primary)]"
            >
              {" "}
              <option value="http">
                {t("serversPage.create.directGateway.protocolHttp")}
              </option>{" "}
              <option value="https">
                {t("serversPage.create.directGateway.protocolHttps")}
              </option>{" "}
            </select>
            <p className="mt-1 text-xs leading-4 text-[var(--text-muted)]">
              {t("serversPage.create.directGateway.listenNote")}
            </p>
            <p className="mt-1 text-xs leading-4 text-[var(--text-muted)]">
              {t("serversPage.create.directGateway.protocolHttpsHint")}
            </p>
            <label
              className="mt-3 block text-xs font-medium text-[var(--text-primary)]/70"
              htmlFor="directGatewayDomain"
            >
              {t("serversPage.create.directGateway.publicDomain")}
            </label>
            <input
              id="directGatewayDomain"
              name="directGatewayDomain"
              type="text"
              inputMode="url"
              autoComplete="off"
              placeholder={t("serversPage.create.directGateway.publicDomainPlaceholder")}
              className="mt-1 w-full rounded-lg border border-[var(--color-action-border)]/20 bg-[var(--surface-subtle)] px-3 py-2 text-xs text-[var(--text-primary)]"
            />
            <p className="mt-1 text-xs leading-4 text-[var(--text-muted)]">
              {t("serversPage.create.directGateway.publicDomainHint")}
            </p>{" "}
          </div>{" "}
        </div>{" "}
      </label>{" "}
        </div>
      </details>{" "}
      <label className="flex items-start gap-3 border-y border-[var(--border)] py-3 text-sm text-[var(--text-secondary)]">
        <input
          name="saveAsDraftOnConnectionFailure"
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
        />
        <span>
          <span className="block font-medium text-[var(--text-primary)]">
            {t("serversPage.create.saveDraftOnFailure")}
          </span>
          <span className="mt-1 block text-xs text-[var(--text-muted)]">
            {t("serversPage.create.saveDraftOnFailureHint")}
          </span>
        </span>
      </label>
      </>}
      <div className="space-y-1.5">
        {" "}
        <label
          className="text-xs font-medium text-[var(--text-primary)]/70 "
          htmlFor="serverTags"
        >
          {t("serversPage.create.tags")}
        </label>{" "}
        <input
          id="serverTags"
          name="tags"
          type="text"
          placeholder={t("serversPage.create.tagsPlaceholder")}
          className={UI_INPUT}
        />{" "}
      </div>{" "}
      <SubmitButton
        pendingLabel={t(windows ? "serversPage.create.submitting" : observedHostKeySha256 ? "serversPage.create.submitting" : "serversPage.create.detecting")}
      >
        {t(windows ? "serversPage.windows.save" : observedHostKeySha256 ? "serversPage.create.submitConfirmed" : "serversPage.create.submit")}
      </SubmitButton>{" "}
      {discardDialog}
    </form>
  );
}
