"use client";

import { useState } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { getErrorMessage } from "@/lib/http/error-message";
import { ActionButton } from "@/components/action-button";
import { Dialog } from "@/components/ui/dialog";
import { SegmentedControl } from "@/components/ui-primitives";
import { UI_LABEL } from "@/lib/ui/classes";
import { getBackupTypeLabel } from "@/lib/i18n/domain-labels";

type Props = {
  backupId: string;
  backupType: string;
  disabled?: boolean;
};

type OfflineRestorePlan = {
  checksumSha256: string;
  component: "database" | "files" | "all";
  commands: {
    stopServices: string | null;
    safetySnapshot: string;
    restore: string;
    startServices: string | null;
  };
};

/**
 * Restore is offline only: the platform cannot safely replace its own database
 * and files while it serves requests. This dialog verifies the backup on the
 * server and shows the exact commands to run with the services stopped; the
 * restore scripts refuse to run while the platform is online.
 */
export function RestoreBackupButton({ backupId, backupType, disabled = false }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [component, setComponent] = useState<"all" | "database" | "files">("all");
  const [plan, setPlan] = useState<OfflineRestorePlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openDialog = () => {
    setPlan(null);
    setError(null);
    setOpen(true);
  };

  const prepare = async () => {
    setPending(true);
    setPlan(null);
    setError(null);
    try {
      const result = await csrfFetch(`/api/backups/${backupId}/restore`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ component }),
      }) as { offlineRestore?: OfflineRestorePlan };
      if (!result.offlineRestore) throw new Error(t("backupsPage.restore.errorFallback"));
      setPlan(result.offlineRestore);
    } catch (prepareError) {
      setError(getErrorMessage(prepareError, t("backupsPage.restore.errorFallback")));
    } finally {
      setPending(false);
    }
  };

  const steps = plan
    ? [
        { key: "stop", label: t("backupsPage.restore.step.stop"), command: plan.commands.stopServices ?? t("backupsPage.restore.step.stopManual") },
        { key: "snapshot", label: t("backupsPage.restore.step.snapshot"), command: plan.commands.safetySnapshot },
        { key: "restore", label: t("backupsPage.restore.step.restore"), command: plan.commands.restore },
        { key: "start", label: t("backupsPage.restore.step.start"), command: plan.commands.startServices ?? t("backupsPage.restore.step.startManual") },
      ]
    : [];

  return (
    <div className="grid gap-1">
      <ActionButton size="sm" variant="danger" disabled={disabled} onClick={openDialog} className="w-fit">
        {t("common.restore")}
      </ActionButton>
      {open && (
        <Dialog
          open
          placement="sheet"
          onClose={() => setOpen(false)}
          closeOnBackdrop={false}
          busy={pending}
          title={t("backupsPage.restore.offlineTitle")}
          description={t("backupsPage.restore.offlineIntro", { type: getBackupTypeLabel(t, backupType) })}
          footer={<>
            <ActionButton variant="secondary" disabled={pending} onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </ActionButton>
            <ActionButton variant="primary" loading={pending} onClick={prepare}>
              {pending ? t("backupsPage.restore.preparing") : t("backupsPage.restore.prepare")}
            </ActionButton>
          </>}
        >
          <div className="space-y-4">
            {backupType === "FULL" ? (
              <div className="grid gap-1.5">
                <span className={UI_LABEL}>{t("backupsPage.restore.component.label")}</span>
                <SegmentedControl
                  ariaLabel={t("backupsPage.restore.component.label")}
                  value={component}
                  onChange={(next) => {
                    setComponent(next);
                    setPlan(null);
                  }}
                  options={(["all", "database", "files"] as const).map((c) => ({ value: c, label: t(`backupsPage.restore.component.${c}`), tone: "danger" as const }))}
                />
              </div>
            ) : null}
            {error ? <p role="alert" className="text-xs text-[var(--danger)]">{error}</p> : null}
            {plan ? (
              <div className="space-y-3">
                <p className="text-xs text-[var(--success)]">
                  {t("backupsPage.restore.verified", { checksum: plan.checksumSha256.slice(0, 12) })}
                </p>
                <ol className="space-y-3">
                  {steps.map((step) => (
                    <li key={step.key} className="grid gap-1">
                      <span className="text-xs font-medium text-[var(--text-primary)]">{step.label}</span>
                      <code data-inset="" className="block overflow-x-auto whitespace-pre p-2 font-mono text-xs text-[var(--text-secondary)]">
                        {step.command}
                      </code>
                    </li>
                  ))}
                </ol>
                <p className="text-xs text-[var(--text-muted)]">{t("backupsPage.restore.offlineNote")}</p>
              </div>
            ) : null}
          </div>
        </Dialog>
      )}
    </div>
  );
}
