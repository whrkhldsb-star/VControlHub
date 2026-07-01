"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";

import { SubmitButton } from "@/components/submit-button";
import { useSshTerminal } from "./ssh-terminal-context";
import { useI18n } from "@/lib/i18n/use-locale";

import {
  deleteServerAction,
  toggleDirectGatewayAction,
  toggleServerAction,
  updateServerAction,
  type ServerActionState,
} from "./actions";

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
  const [directState, directAction] = useActionState(
    toggleDirectGatewayAction,
    initialState,
  );
  const [editState, editAction] = useActionState(
    updateServerAction,
    initialState,
  );
  const [showEdit, setShowEdit] = useState(false);
  const { openTerminal } = useSshTerminal();

  const isConfirming =
    deleteState.relatedStorageCount !== undefined &&
    !deleteState.success &&
    !deleteState.error;
  const relatedStorageCount = deleteState.relatedStorageCount ?? 0;

  const handleOpenTerminal = () => {
    onSshConnect?.();
    openTerminal({ serverId, serverName, host: `${host}:${port}`, sessionToken });
  };

  return (
    <>
      <div className="space-y-3">
        {/* SSH Terminal button */}
        {enabled && canUseSshTerminal && (
          <button
            type="button"
            onClick={handleOpenTerminal}
            aria-label={t("serverCardActions.sshTerminalAria").replace("{name}", serverName)}
            data-tone="cyan" className="flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-400/30 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 light:border-cyan-700/30 light:bg-cyan-50 light:hover:bg-cyan-100"
          >
            <span aria-hidden="true">💻</span>
            <span>{t("serverCardActions.sshTerminalButton")}</span>
          </button>
        )}

        {canManageServers && directGateway ? (
          <form
            action={directAction}
            aria-label={t("serverCardActions.directGateway.formAria")}
            data-tone="cyan" className="space-y-3 rounded-2xl border border-cyan-400/20 p-3 light:border-cyan-700/20 light:bg-cyan-50/80"
          >
            <input type="hidden" name="serverId" value={serverId} />
            <input
              type="hidden"
              name="enabledDirectGateway"
              value={directGateway.enabled ? "false" : "true"}
            />
            {!directGateway.enabled ? (
              <div className="space-y-1">
                <label
                  className="block text-[11px] font-medium text-[var(--text-muted)]"
                  htmlFor={`direct-gateway-protocol-${serverId}`}
                >
                  {t("serverCardActions.directGateway.protocol")}
                </label>
                <select
                  id={`direct-gateway-protocol-${serverId}`}
                  name="directGatewayProtocol"
                  defaultValue="http"
                  className="w-full rounded-lg border border-cyan-400/20 bg-[var(--surface-subtle)] px-3 py-2 text-xs text-[var(--text-primary)]"
                >
                  <option value="http">{t("serverCardActions.directGateway.protocolHttp")}</option>
                  <option value="https">{t("serverCardActions.directGateway.protocolHttps")}</option>
                </select>
              </div>
            ) : null}
            <div className="space-y-1" role="status" aria-live="polite">
              <div className="text-xs font-medium text-[var(--text-secondary)]">
                {t("serverCardActions.directGateway.statusPrefix").replace("{status}", directGateway.statusLabel)}
              </div>
              {directGateway.publicUrl ? (
                <a
                  href={directGateway.publicUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block break-all text-xs font-medium text-cyan-100 underline decoration-cyan-300/50 underline-offset-2 hover:text-[var(--text-primary)] light:hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 light:hover:text-cyan-950"
                >
                  {directGateway.publicUrl}
                </a>
              ) : (
                <div className="text-[11px] text-[var(--text-muted)]">
                  {t("serverCardActions.directGateway.relayHint")}
                </div>
              )}
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-3 text-[11px] leading-5 text-[var(--text-muted)] light:border-cyan-700/15">
              {directGateway.enabled ? (
                <>
                  <p className="font-medium text-cyan-100">
                    {t("serverCardActions.directGateway.enabledTitle")}
                  </p>
                  <p>
                    {t("serverCardActions.directGateway.enabledDetail").replace("{port}", String(directGateway.port || t("serverCardActions.directGateway.enabledDetailPortFallback")))}
                  </p>
                </>
              ) : (
                <>
                  <p className="font-medium text-cyan-100">
                    {t("serverCardActions.directGateway.disabledTitle")}
                  </p>
                  <p>
                    {t("serverCardActions.directGateway.disabledDetail")}
                  </p>
                </>
              )}
            </div>
            <SubmitButton
              pendingLabel={
                directGateway.enabled ? t("serverCardActions.directGateway.pendingDisable") : t("serverCardActions.directGateway.pendingEnable")
              }
              data-tone="cyan" className="w-full rounded-2xl border border-cyan-400/30 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 light:border-cyan-700/30 light:bg-cyan-100 light:hover:bg-cyan-200"
            >
              {directGateway.enabled
                ? t("serverCardActions.directGateway.disableLabel")
                : t("serverCardActions.directGateway.enableLabel")}
            </SubmitButton>
            {directState.error ? (
              <div role="alert" className="text-xs text-rose-200">
                {directState.error}
              </div>
            ) : null}
            {directState.success ? (
              <div role="status" className="text-xs text-emerald-200">
                {directState.success}
              </div>
            ) : null}
          </form>
        ) : null}

        {canManageServers ? (
          <button
            type="button"
            onClick={() => setShowEdit((value) => !value)}
            className="w-full rounded-2xl border border-[var(--border)] bg-white/5 px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition hover:bg-white/10"
          >
            {showEdit ? t("serverCardActions.edit.toggleHide") : t("serverCardActions.edit.toggleShow")}
          </button>
        ) : null}

        {canManageServers && showEdit ? (
          <form
            action={editAction}
            aria-label={t("serverCardActions.edit.formAria")}
            className="space-y-3 rounded-2xl border border-[var(--border)] bg-white/[0.03] p-3"
          >
            <input type="hidden" name="serverId" value={serverId} />
            <input type="hidden" name="connectionType" value={connectionType} />
            <label
              className="block text-xs text-[var(--text-muted)]"
              htmlFor={`edit-name-${serverId}`}
            >
              {t("serverCardActions.edit.name")}
            </label>
            <input
              id={`edit-name-${serverId}`}
              name="name"
              type="text"
              defaultValue={serverName}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />
            <label
              className="block text-xs text-[var(--text-muted)]"
              htmlFor={`edit-host-${serverId}`}
            >
              {t("serverCardActions.edit.host")}
            </label>
            <input
              id={`edit-host-${serverId}`}
              name="host"
              type="text"
              defaultValue={host}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />
            <label
              className="block text-xs text-[var(--text-muted)]"
              htmlFor={`edit-port-${serverId}`}
            >
              {t("serverCardActions.edit.port")}
            </label>
            <input
              id={`edit-port-${serverId}`}
              name="port"
              type="number"
              min={1}
              max={65535}
              defaultValue={port}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />
            <label
              className="block text-xs text-[var(--text-muted)]"
              htmlFor={`edit-username-${serverId}`}
            >
              {t("serverCardActions.edit.username")}
            </label>
            <input
              id={`edit-username-${serverId}`}
              name="username"
              type="text"
              defaultValue={username}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />
            {connectionType === "PASSWORD" ? (
              <>
                <label
                  className="block text-xs text-[var(--text-muted)]"
                  htmlFor={`edit-password-${serverId}`}
                >
                  {t("serverCardActions.edit.password")}
                </label>
                <input
                  id={`edit-password-${serverId}`}
                  name="password"
                  type="password"
                  defaultValue=""
                  autoComplete="new-password"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-sm text-[var(--text-primary)]"
                />
              </>
            ) : null}
            <label
              className="block text-xs text-[var(--text-muted)]"
              htmlFor={`edit-description-${serverId}`}
            >
              {t("serverCardActions.edit.description")}
            </label>
            <textarea
              id={`edit-description-${serverId}`}
              name="description"
              defaultValue={description ?? ""}
              rows={2}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />
            <label
              className="block text-xs text-[var(--text-muted)]"
              htmlFor={`edit-tags-${serverId}`}
            >
              {t("serverCardActions.edit.tags")}
            </label>
            <input
              id={`edit-tags-${serverId}`}
              name="tags"
              type="text"
              defaultValue={(tags ?? []).join(",")}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />
            <SubmitButton
              pendingLabel={t("serverCardActions.edit.pending")}
              data-tone="emerald" className="w-full rounded-2xl border border-emerald-400/30 px-4 py-2 text-sm font-medium text-emerald-100 transition hover:bg-emerald-400/20 light:border-emerald-700/30 light:bg-emerald-50 light:hover:bg-emerald-100"
            >
              {t("serverCardActions.edit.submit")}
            </SubmitButton>
            {editState.error ? (
              <div role="alert" className="text-xs text-rose-200">{editState.error}</div>
            ) : null}
            {editState.success ? (
              <div role="status" className="text-xs text-emerald-200">
                {editState.success}
              </div>
            ) : null}
          </form>
        ) : null}

        {canManageServers ? (
          <form action={toggleAction} className="space-y-2">
            <input type="hidden" name="serverId" value={serverId} />
            <SubmitButton
              pendingLabel={t("serverCardActions.toggle.pending")}
              data-tone="cyan" className="w-full rounded-2xl border border-cyan-400/30 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/20 light:border-cyan-700/30 light:bg-cyan-50 light:hover:bg-cyan-100"
            >
              {enabled ? t("serverCardActions.toggle.disable") : t("serverCardActions.toggle.enable")}
            </SubmitButton>
            {toggleState.error ? (
              <div role="alert" className="text-xs text-rose-200">{toggleState.error}</div>
            ) : null}
            {toggleState.success ? (
              <div role="status" className="text-xs text-emerald-200">
                {toggleState.success}
              </div>
            ) : null}
          </form>
        ) : null}

        {canManageServers ? (
          <form action={deleteAction} className="space-y-2">
            <input type="hidden" name="serverId" value={serverId} />
            {isConfirming ? (
              <div
                role="alertdialog"
                aria-modal="false"
                aria-labelledby={`delete-server-title-${serverId}`}
                aria-describedby={`delete-server-description-${serverId}`}
                data-tone="rose" className="space-y-3 rounded-2xl border border-rose-400/30 p-3 light:bg-rose-50/80"
              >
                <input type="hidden" name="confirmDelete" value="true" />
                <div className="space-y-1 text-sm text-rose-200">
                  <p id={`delete-server-title-${serverId}`} className="font-semibold">
                    {t("serversPage.delete.confirmTitle").replace("{name}", serverName)}
                  </p>
                  <div id={`delete-server-description-${serverId}`}>
                  {relatedStorageCount > 0 ? (
                    <p className="mt-1 text-xs text-rose-300/80">
                      {t("serverCardActions.delete.relatedStorageHint").replace("{count}", String(relatedStorageCount))}
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-rose-300/80">
                    {t("serverCardActions.delete.postConfirmHint")}
                  </p>
                  </div>
                </div>
                <label
                  htmlFor={`delete-confirm-name-${serverId}`}
                  className="block text-xs font-medium text-rose-200"
                >
                  {t("serversPage.delete.confirmNameInput").replace("{name}", serverName)}
                </label>
                <input
                  id={`delete-confirm-name-${serverId}`}
                  name="confirmName"
                  type="text"
                  autoComplete="off"
                  className="w-full rounded-lg border border-rose-400/30 bg-[var(--surface-subtle)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-300"
                />
                <div className="flex gap-2">
                  <SubmitButton
                    pendingLabel={t("serverCardActions.delete.pending")}
                    data-tone="rose" className="flex-1 rounded-2xl border border-rose-400/30 px-4 py-2 text-sm font-medium text-rose-100 transition hover:bg-rose-400/20 light:hover:bg-rose-100 light:hover:bg-rose-200"
                  >
                    {t("common.confirmDelete")}
                  </SubmitButton>
                  <button
                    type="button"
                    onClick={() => router.refresh()}
                    className="flex-1 rounded-2xl border border-[var(--border)] bg-white/5 px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition hover:bg-white/10 light:hover:bg-slate-100"
                  >
                    {t("serverCardActions.delete.cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <SubmitButton
                pendingLabel={t("serverCardActions.delete.pendingLookup")}
                data-tone="rose" className="w-full rounded-2xl border border-rose-400/30 px-4 py-2 text-sm font-medium text-rose-100 transition hover:bg-rose-400/20 light:hover:bg-rose-50 light:hover:bg-rose-100"
              >
                {t("serverCardActions.delete.confirm")}
              </SubmitButton>
            )}
            {deleteState.error ? (
              <div role="alert" className="text-xs text-rose-200">{deleteState.error}</div>
            ) : null}
            {deleteState.success ? (
              <div role="status" className="text-xs text-emerald-200">
                {deleteState.success}
              </div>
            ) : null}
          </form>
        ) : null}
      </div>
    </>
  );
}
