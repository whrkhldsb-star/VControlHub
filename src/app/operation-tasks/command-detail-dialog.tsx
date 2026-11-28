"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ActionButton, ButtonLink } from "@/components/action-button";
import { RefreshCw } from "@/components/icons";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { Dialog } from "@/components/ui/dialog";
import { Badge, InlineLoading, Notice } from "@/components/ui-primitives";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { getErrorMessage } from "@/lib/http/error-message";
import { getDomainStatusLabel } from "@/lib/i18n/domain-labels";
import { useI18n } from "@/lib/i18n/use-locale";
import { commandRequestHref, directCommandHref } from "@/lib/ui/deep-links";

type CommandTargetDetail = {
  id: string;
  serverId: string;
  status: string;
  exitCode: number | null;
  stdout: string | null;
  stderr: string | null;
  server?: { id: string; name: string; host?: string | null } | null;
};

type CommandDetailPayload = {
  id: string;
  title: string;
  command: string;
  commandHidden?: boolean;
  reason?: string | null;
  status: string;
  riskLevel?: string | null;
  origin?: string | null;
  targets: CommandTargetDetail[];
};

const COMMAND_STATUS_TONE: Record<string, StatusTone> = {
  PENDING_APPROVAL: "warning",
  APPROVED: "accent",
  RUNNING: "accent",
  CANCELLING: "warning",
  COMPLETED: "success",
  FAILED: "danger",
  REJECTED: "danger",
  CANCELLED: "neutral",
};

const RISK_TONE: Record<string, StatusTone> = {
  low: "success",
  medium: "info",
  high: "warning",
  critical: "danger",
};

const CANCELLABLE_STATUSES = new Set(["PENDING_APPROVAL", "APPROVED", "RUNNING"]);

type CommandDetailDialogProps = {
  commandRequestId: string | null;
  open: boolean;
  onClose: () => void;
  canCreateCommands: boolean;
  canCancel?: boolean;
  onCancelled?: () => void;
};

export function CommandDetailDialog({
  commandRequestId,
  open,
  onClose,
  canCreateCommands,
  canCancel = false,
  onCancelled,
}: CommandDetailDialogProps) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<CommandDetailPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const activeCommandIdRef = useRef<string | null>(open ? commandRequestId : null);
  useEffect(() => {
    activeCommandIdRef.current = open ? commandRequestId : null;
  }, [open, commandRequestId]);

  const load = useCallback(async () => {
    if (!commandRequestId || !open) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const data = await csrfFetch<{ command: CommandDetailPayload }>(
        `/api/commands/${encodeURIComponent(commandRequestId)}`,
        { signal: controller.signal },
      );
      if (controller.signal.aborted || requestRef.current !== controller) return;
      setDetail(data.command ?? null);
    } catch (err) {
      if (controller.signal.aborted || requestRef.current !== controller) return;
      setError(getErrorMessage(err, t("operationTasksPage.commandDialog.loadError")));
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }, [commandRequestId, open, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset state when switching inspected commands.
    setDetail(null);
    setError(null);
    setLoading(false);
    setCancelling(false);
    if (open && commandRequestId) {
      void load();
    }
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [open, commandRequestId, load]);

  const handleCancel = async () => {
    if (!commandRequestId || cancelling) return;
    const targetId = commandRequestId;
    setCancelling(true);
    setError(null);
    try {
      await csrfFetch("/api/commands", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", commandRequestId: targetId }),
      });
      onCancelled?.();
      if (activeCommandIdRef.current === targetId) {
        await load();
      }
    } catch (err) {
      if (activeCommandIdRef.current === targetId) {
        setError(getErrorMessage(err, t("operationTasksPage.task.cancelFailed")));
      }
    } finally {
      if (activeCommandIdRef.current === targetId) {
        setCancelling(false);
      }
    }
  };

  if (!open || !commandRequestId) return null;

  const canRerun = Boolean(canCreateCommands && detail && !detail.commandHidden && detail.command);
  const showCancel = Boolean(canCancel && detail && CANCELLABLE_STATUSES.has(detail.status));

  return (
    <Dialog
      size="2xl"
      open={open}
      onClose={onClose}
      title={detail?.title || t("operationTasksPage.commandDialog.title")}
      description={<span className="font-mono text-xs">{commandRequestId}</span>}
      closeLabel={t("jobEventsDialog.closeAria")}
      closeButtonRef={closeButtonRef}
      initialFocusRef={closeButtonRef}
      footer={
        <>
          <ActionButton
            variant="secondary"
            icon={<RefreshCw aria-hidden />}
            onClick={() => void load()}
            disabled={loading}
          >
            {t("jobEventsDialog.refresh")}
          </ActionButton>
          {showCancel ? (
            <ActionButton
              variant="danger"
              onClick={() => void handleCancel()}
              disabled={cancelling}
            >
              {cancelling ? t("operationTasksPage.task.cancelling") : t("operationTasksPage.task.cancel")}
            </ActionButton>
          ) : null}
          {canRerun ? (
            <ButtonLink href={directCommandHref({ fromRequestId: commandRequestId })} variant="secondary">
              {t("operationTasksPage.task.rerun")}
            </ButtonLink>
          ) : null}
          <ButtonLink href={commandRequestHref(commandRequestId)} variant="primary">
            {t("operationTasksPage.task.openApproval")}
          </ButtonLink>
        </>
      }
    >
      <div className="space-y-4" aria-busy={loading}>
        {error ? <Notice tone="danger" compact>{error}</Notice> : null}
        {loading && !detail ? (
          <InlineLoading label={t("operationTasksPage.commandDialog.loading")} />
        ) : null}
        {detail ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={COMMAND_STATUS_TONE[detail.status] ?? "neutral"}>
                {getDomainStatusLabel(t, detail.status)}
              </StatusBadge>
              {detail.riskLevel ? (
                <StatusBadge tone={RISK_TONE[detail.riskLevel] ?? "neutral"}>
                  {detail.riskLevel}
                </StatusBadge>
              ) : null}
              {detail.origin ? <Badge>{detail.origin}</Badge> : null}
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-[var(--text-muted)]">
                {t("operationTasksPage.commandDialog.commandLabel")}
              </div>
              {detail.commandHidden ? (
                <Notice tone="info" compact>{t("operationTasksPage.commandDialog.commandHidden")}</Notice>
              ) : (
                <pre
                  tabIndex={0}
                  aria-label={t("operationTasksPage.commandDialog.commandLabel")}
                  data-inset
                  className="max-h-40 overflow-auto whitespace-pre-wrap break-all px-3 py-2 font-mono text-xs text-[var(--text-primary)]"
                >
                  {detail.command}
                </pre>
              )}
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-muted)]">
                <span>{t("operationTasksPage.commandDialog.targets")}</span>
                <Badge>{detail.targets.length}</Badge>
              </div>
              {detail.targets.map((target) => {
                const label = target.server?.name || target.serverId;
                const hasOutput = Boolean(target.stdout || target.stderr);
                return (
                  <div key={target.id} data-inset className="space-y-2 px-3 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-medium text-[var(--text-primary)]">{label}</span>
                      <div className="flex items-center gap-2">
                        {target.exitCode !== null && target.exitCode !== undefined ? (
                          <Badge>{t("operationTasksPage.commandDialog.exitCode", { code: target.exitCode })}</Badge>
                        ) : null}
                        <StatusBadge tone={COMMAND_STATUS_TONE[target.status] ?? "neutral"}>
                          {getDomainStatusLabel(t, target.status)}
                        </StatusBadge>
                      </div>
                    </div>
                    {!detail.commandHidden ? (
                      hasOutput ? (
                        <div className="space-y-2">
                          {target.stdout ? (
                            <div>
                              <div className="mb-1 text-[11px] font-medium text-[var(--text-muted)]">
                                {t("operationTasksPage.commandDialog.stdout")}
                              </div>
                              <pre
                                tabIndex={0}
                                aria-label={`${label} ${t("operationTasksPage.commandDialog.stdout")}`}
                                className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded border border-[var(--border-subtle)] bg-[var(--surface)] px-2.5 py-2 font-mono text-xs text-[var(--text-secondary)]"
                              >
                                {target.stdout}
                              </pre>
                            </div>
                          ) : null}
                          {target.stderr ? (
                            <div>
                              <div className="mb-1 text-[11px] font-medium text-[var(--danger)]">
                                {t("operationTasksPage.commandDialog.stderr")}
                              </div>
                              <pre
                                tabIndex={0}
                                aria-label={`${label} ${t("operationTasksPage.commandDialog.stderr")}`}
                                className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-[var(--border-subtle)] bg-[var(--surface)] px-2.5 py-2 font-mono text-xs text-[var(--danger)]"
                              >
                                {target.stderr}
                              </pre>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <p className="text-xs text-[var(--text-muted)]">
                          {t("operationTasksPage.commandDialog.noOutput")}
                        </p>
                      )
                    ) : null}
                  </div>
                );
              })}
            </div>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
