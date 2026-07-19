"use client";
import { useActionState, useEffect, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { createServerAction, type ServerActionState } from "./actions";
import { ConnectionTypeFields } from "./server-connection-type-fields";
import { useI18n } from "@/lib/i18n/use-locale";
import { UI_INPUT } from "@/lib/ui/classes";
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
  const [state, formAction] = useActionState(createServerAction, initialState);
  // First TOFU/host-key probe returns hostKeySha256 in action state.
  // Controlled input so the probed fingerprint fills immediately (defaultValue does not).
  const [approvedHostKeySha256, setApprovedHostKeySha256] = useState(
    () => state.hostKeySha256 ?? "",
  );
  useEffect(() => {
    if (state.hostKeySha256) {
      setApprovedHostKeySha256(state.hostKeySha256);
    }
  }, [state.hostKeySha256]);
  return (
    <form action={formAction} data-card className="grid gap-4 ">
      {" "}
      <div>
        {" "}
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          {t("serversPage.create.title")}
        </h2>{" "}
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          {t("serversPage.create.desc")}
        </p>{" "}
      </div>{" "}
      {state.error && (
        <div className="rounded-lg bg-[var(--danger)]/[0.10] border border-[var(--danger-border)] px-3.5 py-2.5 text-sm text-[var(--danger)]">
          {" "}
          {state.error}{" "}
        </div>
      )}{" "}
      {state.success && (
        <div className="rounded-lg bg-[var(--success)]/[0.10] border border-[var(--success-border)] px-3.5 py-2.5 text-sm text-[var(--success)]">
          {" "}
          {state.success}{" "}
        </div>
      )}{" "}
      <div className="grid gap-3 sm:grid-cols-2">
        {" "}
        <div className="space-y-1.5">
          {" "}
          <label
            className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide"
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
            className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide"
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
            className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide"
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
            className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide"
            htmlFor="serverPort"
          >
            {t("serversPage.create.port")}
          </label>{" "}
          <input
            id="serverPort"
            name="port"
            type="number"
            defaultValue={22}
            min={1}
            max={65535}
            className={UI_INPUT}
          />{" "}
        </div>{" "}
      </div>{" "}
      <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
        {" "}
        <label className="flex items-start gap-3 text-sm text-[var(--text-secondary)]">
          {" "}
          <input
            name="costAutoSync"
            type="checkbox"
            className="mt-1 h-4 w-4 rounded-lg border-[var(--border)] bg-[var(--input-bg)]"
          />{" "}
          <span>
            {" "}
            <span className="block font-medium text-[var(--text-primary)]">
              {t("serversPage.create.costAutoSync")}
            </span>{" "}
            <span className="text-xs text-[var(--text-muted)]">
              {t("serversPage.create.costHint")}
            </span>{" "}
          </span>{" "}
        </label>{" "}
        <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
          {" "}
          <div className="space-y-1.5">
            {" "}
            <label
              className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide"
              htmlFor="serverCostMonthlyAmount"
            >
              {" "}
              {t("serversPage.create.costMonthlyAmount")}{" "}
            </label>{" "}
            <input
              id="serverCostMonthlyAmount"
              name="costMonthlyAmount"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              className={UI_INPUT}
            />{" "}
          </div>{" "}
          <div className="space-y-1.5">
            {" "}
            <label
              className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide"
              htmlFor="serverCostCurrency"
            >
              {" "}
              {t("serversPage.create.costCurrency")}{" "}
            </label>{" "}
            <select
              id="serverCostCurrency"
              name="costCurrency"
              defaultValue="CNY"
              className={UI_INPUT}
            >
              {" "}
              {(["CNY", "USD", "EUR", "JPY", "HKD"] as const).map(
                (currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ),
              )}{" "}
            </select>{" "}
          </div>{" "}
        </div>{" "}
        <div className="space-y-1.5">
          {" "}
          <label
            className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide"
            htmlFor="serverCostProvider"
          >
            {" "}
            {t("serversPage.create.costProvider")}{" "}
          </label>{" "}
          <input
            id="serverCostProvider"
            name="costProvider"
            type="text"
            placeholder={t("serversPage.create.costProviderPlaceholder")}
            className={UI_INPUT}
          />{" "}
        </div>{" "}
      </div>{" "}
      <ConnectionTypeFields sshKeys={sshKeys} />{" "}
      <div className="rounded-xl border border-[var(--warning-border)] bg-[var(--warning-bg)] p-4 text-sm text-[var(--text-secondary)]">
        <label className="block space-y-2" htmlFor="approvedHostKeySha256">
          <span className="block font-medium text-[var(--text-primary)]">
            {t("serversPage.create.hostKeyTrustTitle")}
          </span>
          <span className="block text-xs text-[var(--text-secondary)]">
            {t("serversPage.create.hostKeyTrustDesc")}
          </span>
          <input
            id="approvedHostKeySha256"
            name="approvedHostKeySha256"
            type="text"
            value={approvedHostKeySha256}
            onChange={(event) => setApprovedHostKeySha256(event.target.value)}
            placeholder="SHA256:..."
            className="mt-2 w-full rounded-lg border border-[var(--warning-border)] bg-[var(--input-bg)] px-3 py-2 font-mono text-xs text-[var(--text-primary)]"
          />
          <span className="block text-xs text-[var(--warning)]">
            {t("serversPage.create.hostKeyTrustHint")}
          </span>
        </label>
      </div>{" "}
      <div className="space-y-1.5">
        {" "}
        <label
          className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide"
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
            </select>{" "}
          </div>{" "}
        </div>{" "}
      </label>{" "}
      <div className="space-y-1.5">
        {" "}
        <label
          className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide"
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
      <SubmitButton pendingLabel={t("serversPage.create.submitting")}>
        {t("serversPage.create.submit")}
      </SubmitButton>{" "}
    </form>
  );
}
