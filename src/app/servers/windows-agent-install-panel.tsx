"use client";

import { useActionState, useState } from "react";

import { SubmitButton } from "@/components/submit-button";
import { useI18n } from "@/lib/i18n/use-locale";
import {
  getWindowsAgentInstallCommandAction,
} from "./actions";

/**
 * Windows nodes cannot be pushed an agent over SSH. This panel shows the agent
 * connection state and lets an operator fetch the one-time PowerShell install
 * one-liner (fetching it re-issues the token and revokes the previous one).
 */
export function WindowsAgentInstallPanel({
  serverId,
  agentOnline,
  agentLastError,
  canManageServers,
}: {
  serverId: string;
  agentOnline: boolean;
  agentLastError: string | null;
  canManageServers: boolean;
}) {
  const { t } = useI18n();
  const [state, formAction] = useActionState(getWindowsAgentInstallCommandAction, null);
  const [copied, setCopied] = useState(false);

  return (
    <div className="mt-4 space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-[var(--text-primary)]">{t("serversPage.windows.agentStatus")}</span>
        <span
          role="status"
          className={`rounded-md border px-2 py-0.5 text-xs font-medium ${
            agentOnline
              ? "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]"
              : "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)]"
          }`}
        >
          {t(agentOnline ? "serversPage.windows.agentConnected" : "serversPage.windows.agentNotConnected")}
        </span>
      </div>

      {agentLastError ? (
        <p className="break-words text-xs text-[var(--text-muted)]">
          {t("serversPage.windows.agentLastError")}: {agentLastError}
        </p>
      ) : null}

      {state?.error ? (
        <p role="alert" className="text-xs text-[var(--danger)]">{state.error}</p>
      ) : null}

      {state?.success && !state?.installCommand ? (
        <p role="status" className="text-xs text-[var(--success)]">{state.success}</p>
      ) : null}

      {state?.installCommand ? (
        <div className="space-y-2">
          <p role="status" className="text-xs text-[var(--success)]">{state.success}</p>
          <p className="text-xs font-medium text-[var(--text-primary)]">{t("serversPage.windows.installCommandTitle")}</p>
          <p className="text-xs leading-5 text-[var(--text-muted)]">{t("serversPage.windows.installCommandHint")}</p>
          <code data-agent-install-command className="block max-h-32 overflow-y-auto break-all rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 font-mono text-xs text-[var(--text-primary)]">
            {state.installCommand}
          </code>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(state.installCommand ?? "").then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2000);
              });
            }}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition hover:bg-[var(--surface-hover)]"
          >
            {copied ? t("serversPage.windows.installCommandCopied") : t("serversPage.windows.copyCommand")}
          </button>
        </div>
      ) : canManageServers ? (
        <form action={formAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="serverId" value={serverId} />
          <SubmitButton variant="secondary" pendingLabel={t("serversPage.create.submitting")} className="!px-3 !py-1.5 !text-sm">
            {t("serversPage.windows.getInstallCommand")}
          </SubmitButton>
        </form>
      ) : null}
    </div>
  );
}
