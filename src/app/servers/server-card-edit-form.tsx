"use client";

import { useEffect, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { useI18n } from "@/lib/i18n/use-locale";
import type { ServerActionState } from "./actions";

import { UI_INPUT } from "@/lib/ui/classes";
type Props = {
  serverId: string;
  serverName: string;
  host: string;
  port: number;
  username: string;
  connectionType: "SSH_KEY" | "PASSWORD";
  description: string | null | undefined;
  tags: string[] | null | undefined;
  costAutoSync: boolean;
  costMonthlyAmount: string | null | undefined;
  costCurrency: "CNY" | "USD" | "EUR" | "JPY" | "HKD";
  costProvider: string | null | undefined;
  costLastSyncedAt: string | null | undefined;
  // form action from useActionState
  editAction: (formData: FormData) => void | Promise<void>;
  editState: ServerActionState;
};

export function ServerCardEditForm({
  serverId,
  serverName,
  host,
  port,
  username,
  connectionType,
  description,
  tags,
  costAutoSync,
  costMonthlyAmount,
  costCurrency,
  costProvider,
  costLastSyncedAt,
  editAction,
  editState,
}: Props) {
  const { t } = useI18n();
  // First TOFU/host-key probe returns hostKeySha256 in action state.
  // Controlled input so the probed fingerprint fills immediately (defaultValue does not).
  const [approvedHostKeySha256, setApprovedHostKeySha256] = useState(
    () => editState.hostKeySha256 ?? "",
  );
  useEffect(() => {
    if (editState.hostKeySha256) {
      setApprovedHostKeySha256(editState.hostKeySha256);
    }
  }, [editState.hostKeySha256]);

  return (
    <form
      action={editAction}
      aria-label={t("serverCardActions.edit.formAria")}
      className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3"
    >
      <input type="hidden" name="serverId" value={serverId} />
      <input type="hidden" name="connectionType" value={connectionType} />
      <label className="block text-xs text-[var(--text-muted)]" htmlFor={`edit-name-${serverId}`}>
        {t("serverCardActions.edit.name")}
      </label>
      <input
        id={`edit-name-${serverId}`}
        name="name"
        type="text"
        defaultValue={serverName}
        className={UI_INPUT}
      />
      <label className="block text-xs text-[var(--text-muted)]" htmlFor={`edit-host-${serverId}`}>
        {t("serverCardActions.edit.host")}
      </label>
      <input
        id={`edit-host-${serverId}`}
        name="host"
        type="text"
        defaultValue={host}
        className={UI_INPUT}
      />
      <label className="block text-xs text-[var(--text-muted)]" htmlFor={`edit-port-${serverId}`}>
        {t("serverCardActions.edit.port")}
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
      <label className="block text-xs text-[var(--text-muted)]" htmlFor={`edit-username-${serverId}`}>
        {t("serverCardActions.edit.username")}
      </label>
      <input
        id={`edit-username-${serverId}`}
        name="username"
        type="text"
        defaultValue={username}
        className={UI_INPUT}
      />
      <label
        className="grid gap-2 rounded-xl border border-[var(--warning-border)] bg-[var(--warning-bg)] p-3 text-xs text-[var(--text-secondary)]"
        htmlFor={`edit-host-key-${serverId}`}
      >
        <span className="block font-medium text-[var(--text-primary)]">
          {t("serverCardActions.edit.hostKeyTrustTitle")}
        </span>
        <span className="block text-[11px] text-[var(--text-muted)]">
          {t("serverCardActions.edit.hostKeyTrustDesc")}
        </span>
        <input
          id={`edit-host-key-${serverId}`}
          name="approvedHostKeySha256"
          type="text"
          value={approvedHostKeySha256}
          onChange={(event) => setApprovedHostKeySha256(event.target.value)}
          placeholder="SHA256:..."
          className="w-full rounded-lg border border-[var(--warning-border)] bg-[var(--input-bg)] px-3 py-2 font-mono text-xs text-[var(--text-primary)]"
        />
      </label>
      {connectionType === "PASSWORD" ? (
        <>
          <label className="block text-xs text-[var(--text-muted)]" htmlFor={`edit-password-${serverId}`}>
            {t("serverCardActions.edit.password")}
          </label>
          <input
            id={`edit-password-${serverId}`}
            name="password"
            type="password"
            defaultValue=""
            autoComplete="new-password"
            className={UI_INPUT}
          />
        </>
      ) : null}
      <label className="block text-xs text-[var(--text-muted)]" htmlFor={`edit-description-${serverId}`}>
        {t("serverCardActions.edit.description")}
      </label>
      <textarea
        id={`edit-description-${serverId}`}
        name="description"
        defaultValue={description ?? ""}
        rows={2}
        className={UI_INPUT}
      />
      <label className="block text-xs text-[var(--text-muted)]" htmlFor={`edit-tags-${serverId}`}>
        {t("serverCardActions.edit.tags")}
      </label>
      <input
        id={`edit-tags-${serverId}`}
        name="tags"
        type="text"
        defaultValue={(tags ?? []).join(",")}
        className={UI_INPUT}
      />
      <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-3">
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
            <span className="text-[11px] text-[var(--text-muted)]">
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
          <p className="text-[11px] text-[var(--text-muted)]">
            {t("serverCardActions.edit.costLastSynced").replace("{time}", costLastSyncedAt)}
          </p>
        ) : null}
      </div>
      <SubmitButton pendingLabel={t("serverCardActions.edit.pending")} variant="success" className="w-full">
        {t("serverCardActions.edit.submit")}
      </SubmitButton>
      {editState.error ? (
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
