"use client";

import { useActionState, useRef, useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { SubmitButton } from "@/components/submit-button";
import { formatDateTime } from "@/lib/datetime/format";
import { useI18n } from "@/lib/i18n/use-locale";
import { WINDOWS_AGENT_VERSION, isAgentOutdated } from "@/lib/server/agent-version";
import {
  getWindowsAgentInstallCommandAction,
} from "./actions";

import { ActionButton } from "@/components/action-button";
import { Copy } from "@/components/icons";
import { copyText } from "@/lib/ui/clipboard";

/**
 * Windows nodes cannot be pushed an agent over SSH. This panel shows the agent
 * connection state and lets an operator fetch the one-time PowerShell install
 * one-liner (fetching it re-issues the token and revokes the previous one).
 */
export function WindowsAgentInstallPanel({
  serverId,
  agentOnline,
  agentVersion,
  agentLastSeenAt,
  agentLastError,
  canManageServers,
}: {
  serverId: string;
  agentOnline: boolean;
  agentVersion: string | null;
  agentLastSeenAt: string | null;
  agentLastError: string | null;
  canManageServers: boolean;
}) {
  const { t, locale } = useI18n();
  const [state, formAction] = useActionState(getWindowsAgentInstallCommandAction, null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  // Fetching the command re-issues the token and disconnects a running Agent:
  // an online node asks first instead of dropping on a stray click (A2-07).
  const [confirmOpen, setConfirmOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const confirmedRef = useRef(false);
  const outdated = isAgentOutdated(agentVersion, "windows");

  return (
    <div data-inset className="mt-4 space-y-2 p-3">
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

      {agentVersion || agentLastSeenAt ? (
        <p className="text-xs text-[var(--text-muted)]">
          {t("serversPage.agent.version")}{t("common.colon")}{agentVersion ?? "—"} · {t("serversPage.agent.lastSeen")}{t("common.colon")}{agentLastSeenAt ? formatDateTime(agentLastSeenAt, locale) : t("serversPage.agent.never")}
        </p>
      ) : null}

      {outdated ? (
        <p className="text-xs text-[var(--warning)]">
          {t("serversPage.agent.outdated", { version: agentVersion ?? "", latest: WINDOWS_AGENT_VERSION })} {t("serversPage.windows.agentUpgradeHint", { latest: WINDOWS_AGENT_VERSION })}
        </p>
      ) : null}

      {agentLastError ? (
        <p className="break-words text-xs text-[var(--text-muted)]">
          {t("serversPage.windows.agentLastError")}{t("common.colon")}{agentLastError}
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
          <code data-inset="" data-agent-install-command className="block max-h-32 overflow-y-auto break-all px-3 py-2 font-mono text-xs text-[var(--text-primary)]">
            {state.installCommand}
          </code>
          <ActionButton
            size="sm"
            variant="secondary"
            icon={<Copy aria-hidden />}
            onClick={() => {
              void copyText(state.installCommand ?? "").then((copied) => {
                setCopyState(copied ? "copied" : "failed");
                if (copied) window.setTimeout(() => setCopyState("idle"), 2000);
              });
            }}
          >
            {copyState === "copied" ? t("serversPage.windows.installCommandCopied") : t("serversPage.windows.copyCommand")}
          </ActionButton>
          {copyState === "failed" ? <p role="alert" className="text-xs text-[var(--danger)]">{t("serversPage.windows.copyFailed")}</p> : null}
        </div>
      ) : canManageServers ? (
        <form
          ref={formRef}
          action={formAction}
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            if (agentOnline && !confirmedRef.current) {
              event.preventDefault();
              setConfirmOpen(true);
              return;
            }
            confirmedRef.current = false;
          }}
        >
          {agentOnline ? <p className="w-full text-xs text-[var(--warning)]">{t("serversPage.windows.reissueWarning")}</p> : null}
          <input type="hidden" name="serverId" value={serverId} />
          <SubmitButton variant="secondary" pendingLabel={t("serversPage.create.submitting")} className="!px-3 !py-1.5 !text-sm">
            {t("serversPage.windows.getInstallCommand")}
          </SubmitButton>
        </form>
      ) : null}
      <ConfirmDialog
        open={confirmOpen}
        title={t("serversPage.windows.reissueConfirmTitle")}
        description={t("serversPage.windows.reissueWarning")}
        cancelLabel={t("common.cancel")}
        confirmLabel={t("serversPage.windows.reissueConfirmAction")}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          confirmedRef.current = true;
          formRef.current?.requestSubmit();
        }}
      />
    </div>
  );
}
