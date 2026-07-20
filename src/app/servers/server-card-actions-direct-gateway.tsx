"use client";

import { useActionState } from "react";

import { SubmitButton } from "@/components/submit-button";
import { useI18n } from "@/lib/i18n/use-locale";

import { toggleDirectGatewayAction, type ServerActionState } from "./actions";

const initialState: ServerActionState = {
  error: undefined,
  success: undefined,
  relatedStorageCount: undefined,
};

export type ServerCardDirectGateway = {
  enabled: boolean;
  statusLabel: string;
  publicUrl: string | null;
  port: number;
};

export function ServerCardDirectGatewayForm({
  serverId,
  directGateway,
}: {
  serverId: string;
  directGateway: ServerCardDirectGateway;
}) {
  const { t } = useI18n();
  const [directState, directAction] = useActionState(
    toggleDirectGatewayAction,
    initialState,
  );

  return (
    <form
      action={directAction}
      aria-label={t("serverCardActions.directGateway.formAria")}
      data-tone="cyan"
      className="space-y-3 rounded-2xl border border-[var(--color-action-border)]/20 p-3 light:border-[var(--color-action-border)]/20 light:bg-[var(--color-action-bg)]/80"
    >
      <input type="hidden" name="serverId" value={serverId} />
      <input
        type="hidden"
        name="enabledDirectGateway"
        value={directGateway.enabled ? "false" : "true"}
      />

      {!directGateway.enabled ? (
        <div className="space-y-2">
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
              className="w-full rounded-lg border border-[var(--color-action-border)]/20 bg-[var(--surface-subtle)] px-3 py-2 text-xs text-[var(--text-primary)]"
            >
              <option value="http">
                {t("serverCardActions.directGateway.protocolHttp")}
              </option>
              <option value="https">
                {t("serverCardActions.directGateway.protocolHttps")}
              </option>
            </select>
          </div>
          <label className="flex items-start gap-2 text-[11px] leading-5 text-[var(--text-secondary)]">
            <input
              type="checkbox"
              name="publicListen"
              value="true"
              defaultChecked
              className="mt-0.5 h-4 w-4 rounded border-[var(--border)] bg-[var(--input-bg)]"
            />
            <span>
              <span className="block font-medium text-[var(--text-primary)]">
                {t("serverCardActions.directGateway.publicListen")}
              </span>
              <span className="text-[var(--text-muted)]">
                {t("serverCardActions.directGateway.publicListenHint")}
              </span>
            </span>
          </label>
        </div>
      ) : null}

      <div className="space-y-1" role="status" aria-live="polite">
        <div className="text-xs font-medium text-[var(--text-secondary)]">
          {t("serverCardActions.directGateway.statusPrefix").replace(
            "{status}",
            directGateway.statusLabel,
          )}
        </div>
        {directGateway.publicUrl ? (
          <a
            href={directGateway.publicUrl}
            target="_blank"
            rel="noreferrer"
            className="block break-all text-xs font-medium text-[var(--text-primary)] underline decoration-[var(--color-action)]/30 underline-offset-2 hover:text-[var(--text-primary)] light:hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-action)] light:hover:text-[var(--accent)]"
          >
            {directGateway.publicUrl}
          </a>
        ) : (
          <div className="text-[11px] text-[var(--text-muted)]">
            {t("serverCardActions.directGateway.relayHint")}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-3 text-[11px] leading-5 text-[var(--text-muted)] light:border-[var(--color-action-border)]/15">
        {directGateway.enabled ? (
          <>
            <p className="font-medium text-[var(--text-primary)]">
              {t("serverCardActions.directGateway.enabledTitle")}
            </p>
            <p>
              {t("serverCardActions.directGateway.enabledDetail").replace(
                "{port}",
                String(
                  directGateway.port ||
                    t(
                      "serverCardActions.directGateway.enabledDetailPortFallback",
                    ),
                ),
              )}
            </p>
          </>
        ) : (
          <>
            <p className="font-medium text-[var(--text-primary)]">
              {t("serverCardActions.directGateway.disabledTitle")}
            </p>
            <p>{t("serverCardActions.directGateway.disabledDetail")}</p>
          </>
        )}
      </div>

      <SubmitButton
        pendingLabel={
          directGateway.enabled
            ? t("serverCardActions.directGateway.pendingDisable")
            : t("serverCardActions.directGateway.pendingEnable")
        }
        variant="ghost"
        className="w-full"
      >
        {directGateway.enabled
          ? t("serverCardActions.directGateway.disableLabel")
          : t("serverCardActions.directGateway.enableLabel")}
      </SubmitButton>

      {directState.error ? (
        <div role="alert" className="text-xs text-[var(--danger)]">
          {directState.error}
        </div>
      ) : null}
      {directState.success ? (
        <div role="status" className="text-xs text-[var(--success)]">
          {directState.success}
        </div>
      ) : null}
    </form>
  );
}
