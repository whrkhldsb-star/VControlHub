"use client";
import { useActionState, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { SubmitButton } from "@/components/submit-button";
import { useSshTerminal } from "./ssh-terminal-context";
import { useI18n } from "@/lib/i18n/use-locale";
import {
  deleteServerAction,
  toggleServerAction,
  updateServerAction,
  type ServerActionState,
} from "./actions";
import { ServerCardDirectGatewayForm } from "./server-card-actions-direct-gateway";
const initialState: ServerActionState = {
  error: undefined,
  success: undefined,
  relatedStorageCount: undefined,
};
type ServerCardActionsProps = {
  serverId: string;
  serverName: string;
  host: string;
  port: number;
  enabled: boolean;
  sessionToken: string;
  username?: string;
  connectionType?: "SSH_KEY" | "PASSWORD";
  description?: string | null;
  tags?: string[] | null;
  costAutoSync?: boolean;
  costMonthlyAmount?: string | null;
  costCurrency?: "CNY" | "USD" | "EUR" | "JPY" | "HKD";
  costProvider?: string | null;
  costLastSyncedAt?: string | null;
  canManageServers?: boolean;
  canUseSshTerminal?: boolean;
  onSshConnect?: () => void;
  directGateway?: {
    enabled: boolean;
    statusLabel: string;
    publicUrl: string | null;
    port: number;
  };
};
export function ServerCardActions({
  serverId,
  serverName,
  host,
  port,
  enabled,
  sessionToken,
  username = "root",
  connectionType = "PASSWORD",
  description = "",
  tags = [],
  costAutoSync = false,
  costMonthlyAmount = null,
  costCurrency = "CNY",
  costProvider = null,
  costLastSyncedAt = null,
  canManageServers = true,
  canUseSshTerminal = false,
  onSshConnect,
  directGateway,
}: ServerCardActionsProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [toggleState, toggleAction] = useActionState(
    toggleServerAction,
    initialState,
  );
  const [deleteState, deleteAction] = useActionState(
    deleteServerAction,
    initialState,
  );
  const [editState, editAction] = useActionState(
    updateServerAction,
    initialState,
  );
  const [showEdit, setShowEdit] = useState(false);
  useEffect(() => {
    if (toggleState.success) router.refresh();
  }, [toggleState.success, router]);

  useEffect(() => {
    if (deleteState.success) router.refresh();
  }, [deleteState.success, router]);
  const { openTerminal } = useSshTerminal();
  const isConfirming =
    deleteState.relatedStorageCount !== undefined &&
    !deleteState.success &&
    !deleteState.error;
  const relatedStorageCount = deleteState.relatedStorageCount ?? 0;
  const handleOpenTerminal = () => {
    onSshConnect?.();
    openTerminal({
      serverId,
      serverName,
      host: `${host}:${port}`,
      sessionToken,
    });
  };
  return (
    <>
      {" "}
      <div className="space-y-3">
        {" "}
        {/* SSH Terminal button */}{" "}
        {enabled && canUseSshTerminal && (
          <button
            type="button"
            onClick={handleOpenTerminal}
            aria-label={t("serverCardActions.sshTerminalAria").replace(
              "{name}",
              serverName,
            )}
            data-tone="cyan"
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-[var(--color-action-border)]/30 px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:bg-[var(--color-action-bg)]/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-action)] light:border-[var(--color-action-border)]/30 light:bg-[var(--color-action-bg)] light:hover:bg-[var(--color-action-bg)]"
          >
            {" "}
            <span aria-hidden="true">💻</span>{" "}
            <span>{t("serverCardActions.sshTerminalButton")}</span>{" "}
          </button>
        )}{" "}
        {canManageServers && directGateway ? (
          <ServerCardDirectGatewayForm
            serverId={serverId}
            directGateway={directGateway}
          />
        ) : null}{" "}
        {canManageServers ? (
          <button
            type="button"
            onClick={() => setShowEdit((value) => !value)}
            className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)]/10 px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface)]/10"
          >
            {" "}
            {showEdit
              ? t("serverCardActions.edit.toggleHide")
              : t("serverCardActions.edit.toggleShow")}{" "}
          </button>
        ) : null}{" "}
        {canManageServers && showEdit ? (
          <form
            action={editAction}
            aria-label={t("serverCardActions.edit.formAria")}
            className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3"
          >
            {" "}
            <input type="hidden" name="serverId" value={serverId} />{" "}
            <input type="hidden" name="connectionType" value={connectionType} />{" "}
            <label
              className="block text-xs text-[var(--text-muted)]"
              htmlFor={`edit-name-${serverId}`}
            >
              {" "}
              {t("serverCardActions.edit.name")}{" "}
            </label>{" "}
            <input
              id={`edit-name-${serverId}`}
              name="name"
              type="text"
              defaultValue={serverName}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />{" "}
            <label
              className="block text-xs text-[var(--text-muted)]"
              htmlFor={`edit-host-${serverId}`}
            >
              {" "}
              {t("serverCardActions.edit.host")}{" "}
            </label>{" "}
            <input
              id={`edit-host-${serverId}`}
              name="host"
              type="text"
              defaultValue={host}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />{" "}
            <label
              className="block text-xs text-[var(--text-muted)]"
              htmlFor={`edit-port-${serverId}`}
            >
              {" "}
              {t("serverCardActions.edit.port")}{" "}
            </label>{" "}
            <input
              id={`edit-port-${serverId}`}
              name="port"
              type="number"
              min={1}
              max={65535}
              defaultValue={port}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />{" "}
            <label
              className="block text-xs text-[var(--text-muted)]"
              htmlFor={`edit-username-${serverId}`}
            >
              {" "}
              {t("serverCardActions.edit.username")}{" "}
            </label>{" "}
            <input
              id={`edit-username-${serverId}`}
              name="username"
              type="text"
              defaultValue={username}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />{" "}
            <label className="grid gap-2 rounded-xl border border-[var(--warning-border)] bg-[var(--warning-bg)] p-3 text-xs text-[var(--text-secondary)]" htmlFor={`edit-host-key-${serverId}`}>
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
                defaultValue={editState.hostKeySha256 ?? ""}
                placeholder="SHA256:..."
                className="w-full rounded-lg border border-[var(--warning-border)] bg-[var(--input-bg)] px-3 py-2 font-mono text-xs text-[var(--text-primary)]"
              />
            </label>{" "}
            {connectionType === "PASSWORD" ? (
              <>
                {" "}
                <label
                  className="block text-xs text-[var(--text-muted)]"
                  htmlFor={`edit-password-${serverId}`}
                >
                  {" "}
                  {t("serverCardActions.edit.password")}{" "}
                </label>{" "}
                <input
                  id={`edit-password-${serverId}`}
                  name="password"
                  type="password"
                  defaultValue=""
                  autoComplete="new-password"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-sm text-[var(--text-primary)]"
                />{" "}
              </>
            ) : null}{" "}
            <label
              className="block text-xs text-[var(--text-muted)]"
              htmlFor={`edit-description-${serverId}`}
            >
              {" "}
              {t("serverCardActions.edit.description")}{" "}
            </label>{" "}
            <textarea
              id={`edit-description-${serverId}`}
              name="description"
              defaultValue={description ?? ""}
              rows={2}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />{" "}
            <label
              className="block text-xs text-[var(--text-muted)]"
              htmlFor={`edit-tags-${serverId}`}
            >
              {" "}
              {t("serverCardActions.edit.tags")}{" "}
            </label>{" "}
            <input
              id={`edit-tags-${serverId}`}
              name="tags"
              type="text"
              defaultValue={(tags ?? []).join(",")}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />{" "}
            <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-3">
              {" "}
              <label className="flex items-start gap-2 text-xs text-[var(--text-secondary)]">
                {" "}
                <input
                  name="costAutoSync"
                  type="checkbox"
                  defaultChecked={costAutoSync}
                  className="mt-0.5 h-4 w-4 rounded border-[var(--border)] bg-[var(--input-bg)]"
                />{" "}
                <span>
                  {" "}
                  <span className="block font-medium text-[var(--text-primary)]">
                    {t("serverCardActions.edit.costAutoSync")}
                  </span>{" "}
                  <span className="text-[11px] text-[var(--text-muted)]">
                    {t("serverCardActions.edit.costHint")}
                  </span>{" "}
                </span>{" "}
              </label>{" "}
              <div className="grid gap-2 sm:grid-cols-[1fr_90px]">
                {" "}
                <input
                  name="costMonthlyAmount"
                  type="text"
                  inputMode="decimal"
                  defaultValue={costMonthlyAmount ?? ""}
                  placeholder="0.00"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm text-[var(--text-primary)]"
                  aria-label={t("serverCardActions.edit.costMonthlyAmount")}
                />{" "}
                <select
                  name="costCurrency"
                  defaultValue={costCurrency}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm text-[var(--text-primary)]"
                  aria-label={t("serverCardActions.edit.costCurrency")}
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
              <input
                name="costProvider"
                type="text"
                defaultValue={costProvider ?? ""}
                placeholder={t(
                  "serverCardActions.edit.costProviderPlaceholder",
                )}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm text-[var(--text-primary)]"
                aria-label={t("serverCardActions.edit.costProvider")}
              />{" "}
              {costLastSyncedAt ? (
                <p className="text-[11px] text-[var(--text-muted)]">
                  {" "}
                  {t("serverCardActions.edit.costLastSynced").replace(
                    "{time}",
                    costLastSyncedAt,
                  )}{" "}
                </p>
              ) : null}{" "}
            </div>{" "}
            <SubmitButton
              pendingLabel={t("serverCardActions.edit.pending")}
              data-tone="emerald"
              className="w-full rounded-2xl border border-[var(--success-border)] px-4 py-2 text-sm font-medium text-[var(--success)] transition hover:bg-[var(--success-bg)] hover:text-[var(--success)] light:border-[var(--success-border)] light:bg-[var(--success-bg)] light:hover:bg-[var(--success-bg)]"
            >
              {" "}
              {t("serverCardActions.edit.submit")}{" "}
            </SubmitButton>{" "}
            {editState.error ? (
              <div role="alert" className="text-xs text-[var(--danger)]">
                {editState.error}
              </div>
            ) : null}{" "}
            {editState.success ? (
              <div role="status" className="text-xs text-[var(--success)]">
                {" "}
                {editState.success}{" "}
              </div>
            ) : null}{" "}
          </form>
        ) : null}{" "}
        {canManageServers ? (
          <form action={toggleAction} className="space-y-2">
            {" "}
            <input type="hidden" name="serverId" value={serverId} />{" "}
            <SubmitButton
              pendingLabel={t("serverCardActions.toggle.pending")}
              data-tone="cyan"
              className="w-full rounded-2xl border border-[var(--accent-border)] bg-[var(--accent-bg)] px-4 py-2 text-sm font-medium text-[var(--accent)] transition hover:bg-[var(--accent-bg)]"
            >
              {" "}
              {enabled
                ? t("serverCardActions.toggle.disable")
                : t("serverCardActions.toggle.enable")}{" "}
            </SubmitButton>{" "}
            {toggleState.error ? (
              <div role="alert" className="text-xs text-[var(--danger)]">
                {toggleState.error}
              </div>
            ) : null}{" "}
            {toggleState.success ? (
              <div role="status" className="text-xs text-[var(--success)]">
                {" "}
                {toggleState.success}{" "}
              </div>
            ) : null}{" "}
          </form>
        ) : null}{" "}
        {canManageServers ? (
          <form action={deleteAction} className="space-y-2">
            {" "}
            <input type="hidden" name="serverId" value={serverId} />{" "}
            {isConfirming ? (
              <div
                role="alertdialog"
                aria-modal="true"
                aria-labelledby={`delete-server-title-${serverId}`}
                aria-describedby={`delete-server-description-${serverId}`}
                data-tone="rose"
                className="space-y-3 rounded-2xl border border-[var(--danger-border)] p-3 light:bg-[var(--danger-bg)]"
              >
                {" "}
                <input type="hidden" name="confirmDelete" value="true" />{" "}
                <div className="space-y-1 text-sm text-[var(--danger)]">
                  {" "}
                  <p
                    id={`delete-server-title-${serverId}`}
                    className="font-semibold"
                  >
                    {" "}
                    {t("serversPage.delete.confirmTitle").replace(
                      "{name}",
                      serverName,
                    )}{" "}
                  </p>{" "}
                  <div id={`delete-server-description-${serverId}`}>
                    {" "}
                    {relatedStorageCount > 0 ? (
                      <p className="mt-1 text-xs text-[var(--danger)]">
                        {" "}
                        {t(
                          "serverCardActions.delete.relatedStorageHint",
                        ).replace("{count}", String(relatedStorageCount))}{" "}
                      </p>
                    ) : null}{" "}
                    <p className="mt-1 text-xs text-[var(--danger)]">
                      {" "}
                      {t("serverCardActions.delete.postConfirmHint")}{" "}
                    </p>{" "}
                  </div>{" "}
                </div>{" "}
                <label
                  htmlFor={`delete-confirm-name-${serverId}`}
                  className="block text-xs font-medium text-[var(--danger)]"
                >
                  {" "}
                  {t("serversPage.delete.confirmNameInput").replace(
                    "{name}",
                    serverName,
                  )}{" "}
                </label>{" "}
                <input
                  id={`delete-confirm-name-${serverId}`}
                  name="confirmName"
                  type="text"
                  autoComplete="off"
                  className="w-full rounded-lg border border-[var(--danger-border)] bg-[var(--surface-subtle)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--danger)]"
                />{" "}
                <div className="flex gap-2">
                  {" "}
                  <SubmitButton
                    pendingLabel={t("serverCardActions.delete.pending")}
                    data-tone="rose"
                    className="flex-1 rounded-2xl border border-[var(--danger-border)] px-4 py-2 text-sm font-medium text-[var(--danger)] transition hover:bg-[var(--danger-bg)] hover:text-[var(--danger)] light:hover:bg-[var(--danger-bg)] light:hover:bg-[var(--danger-bg)] hover:text-[var(--danger)]"
                  >
                    {" "}
                    {t("common.confirmDelete")}{" "}
                  </SubmitButton>{" "}
                  <button
                    type="button"
                    onClick={() => router.refresh()}
                    className="flex-1 rounded-2xl border border-[var(--border)] bg-[var(--surface)]/10 px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface)]/10 light:hover:bg-[var(--surface-subtle)]"
                  >
                    {" "}
                    {t("serverCardActions.delete.cancel")}{" "}
                  </button>{" "}
                </div>{" "}
              </div>
            ) : (
              <SubmitButton
                pendingLabel={t("serverCardActions.delete.pendingLookup")}
                data-tone="rose"
                className="w-full rounded-2xl border border-[var(--danger-border)] px-4 py-2 text-sm font-medium text-[var(--danger)] transition hover:bg-[var(--danger-bg)] hover:text-[var(--danger)] light:hover:bg-[var(--danger-bg)] light:hover:bg-[var(--danger-bg)]"
              >
                {" "}
                {t("serverCardActions.delete.confirm")}{" "}
              </SubmitButton>
            )}{" "}
            {deleteState.error ? (
              <div role="alert" className="text-xs text-[var(--danger)]">
                {deleteState.error}
              </div>
            ) : null}{" "}
            {deleteState.success ? (
              <div role="status" className="text-xs text-[var(--success)]">
                {" "}
                {deleteState.success}{" "}
              </div>
            ) : null}{" "}
          </form>
        ) : null}{" "}
      </div>{" "}
    </>
  );
}
