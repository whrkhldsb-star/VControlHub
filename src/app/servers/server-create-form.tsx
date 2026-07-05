"use client";
import { useState } from "react";
import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { createServerAction, type ServerActionState } from "./actions";
import { useI18n } from "@/lib/i18n/use-locale";
const initialState: ServerActionState = {
  error: undefined,
  success: undefined,
  relatedStorageCount: undefined,
};
function ConnectionTypeFields({
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
  const [connectionType, setConnectionType] = useState<"SSH_KEY" | "PASSWORD">(
    "SSH_KEY",
  );
  return (
    <div className="space-y-4">
      {" "}
      <fieldset className="space-y-1.5">
        {" "}
        <legend className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide">
          {t("serversPage.create.connectionType")}
        </legend>{" "}
        <div className="flex gap-2">
          {" "}
          {(["SSH_KEY", "PASSWORD"] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setConnectionType(type)}
              className={`flex-1 rounded-lg border px-3.5 py-2 text-sm transition ${connectionType === type ? "border-[var(--color-action-border)]/20 bg-[var(--color-action-bg)]/[0.10] text-[var(--text-primary)] font-medium" : "border-[var(--border)] bg-[var(--surface)]/[0.04] text-[var(--text-secondary)] hover:bg-[var(--surface)]/[0.10]"}`}
            >
              {" "}
              {type === "SSH_KEY"
                ? t("serversPage.create.sshKey")
                : t("serversPage.create.password")}{" "}
            </button>
          ))}{" "}
        </div>{" "}
        <input
          type="hidden"
          name="connectionType"
          value={connectionType}
        />{" "}
      </fieldset>{" "}
      {connectionType === "SSH_KEY" ? (
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
          {" "}
          <div className="space-y-1.5">
            {" "}
            <label
              className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide"
              htmlFor="sshKeyId"
            >
              {t("serversPage.create.sshKey")}
            </label>{" "}
            <select
              id="sshKeyId"
              name="sshKeyId"
              required
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--color-action-border)]/30 focus:bg-[var(--surface)]/[0.10]"
            >
              {" "}
              <option value="">{t("serversPage.create.selectKey")}</option>{" "}
              {sshKeys.map((key) => (
                <option key={key.id} value={key.id}>
                  {" "}
                  {key.name}{" "}
                </option>
              ))}{" "}
            </select>{" "}
          </div>{" "}
          <div className="space-y-1.5">
            {" "}
            <label
              className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide"
              htmlFor="serverUsername"
            >
              {t("serversPage.create.username")}
            </label>{" "}
            <input
              key="ssh-key-username"
              id="serverUsername"
              name="username"
              type="text"
              defaultValue="root"
              placeholder="root"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-primary)]/30 focus:border-[var(--color-action-border)]/30 focus:bg-[var(--surface)]/[0.10]"
            />{" "}
          </div>{" "}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {" "}
          <div className="space-y-1.5">
            {" "}
            <label
              className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide"
              htmlFor="serverUsername"
            >
              {t("serversPage.create.username")}
            </label>{" "}
            <input
              key="password-username"
              id="serverUsername"
              name="username"
              type="text"
              defaultValue="root"
              placeholder="root"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-primary)]/30 focus:border-[var(--color-action-border)]/30 focus:bg-[var(--surface)]/[0.10]"
            />{" "}
          </div>{" "}
          <div className="space-y-1.5">
            {" "}
            <label
              className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide"
              htmlFor="serverPassword"
            >
              {t("serversPage.create.password")}
            </label>{" "}
            <input
              key="password-secret"
              id="serverPassword"
              name="password"
              type="password"
              defaultValue=""
              autoComplete="new-password"
              placeholder={t("serversPage.create.passwordPlaceholder")}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-primary)]/30 focus:border-[var(--color-action-border)]/30 focus:bg-[var(--surface)]/[0.10]"
            />{" "}
            <p className="text-[11px] text-[var(--text-muted)]">
              {t("serversPage.create.passwordHint")}
            </p>{" "}
          </div>{" "}
        </div>
      )}{" "}
    </div>
  );
}
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
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-primary)]/30 focus:border-[var(--color-action-border)]/30 focus:bg-[var(--surface)]/[0.10]"
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
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-primary)]/30 focus:border-[var(--color-action-border)]/30 focus:bg-[var(--surface)]/[0.10]"
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
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-primary)]/30 focus:border-[var(--color-action-border)]/30 focus:bg-[var(--surface)]/[0.10]"
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
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--color-action-border)]/30 focus:bg-[var(--surface)]/[0.10]"
          />{" "}
        </div>{" "}
      </div>{" "}
      <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)]/[0.04] p-4">
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
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-primary)]/30 focus:border-[var(--color-action-border)]/30 focus:bg-[var(--surface)]/[0.10]"
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
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--color-action-border)]/30 focus:bg-[var(--surface)]/[0.10]"
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
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-primary)]/30 focus:border-[var(--color-action-border)]/30 focus:bg-[var(--surface)]/[0.10]"
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
            defaultValue={state.hostKeySha256 ?? ""}
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
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-primary)]/30 focus:border-[var(--color-action-border)]/30 focus:bg-[var(--surface)]/[0.10]"
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
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-primary)]/30 focus:border-[var(--color-action-border)]/30 focus:bg-[var(--surface)]/[0.10]"
        />{" "}
      </div>{" "}
      <SubmitButton pendingLabel={t("serversPage.create.submitting")}>
        {t("serversPage.create.submit")}
      </SubmitButton>{" "}
    </form>
  );
}
