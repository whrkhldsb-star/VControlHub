"use client";

import { useI18n } from "@/lib/i18n/use-locale";
import { UI_INPUT } from "@/lib/ui/classes";
import type { ServerSyncTargetAuth } from "@/lib/sync/target-auth";

/**
 * How a sync job's source logs in to this server when it is the job's target
 * (Linux servers; see lib/sync/target-auth). "inherit" follows the platform
 * setting sync.targetAuthDefault.
 */
export function ServerSyncTargetAuthField({ id, defaultValue = "inherit" }: { id: string; defaultValue?: ServerSyncTargetAuth }) {
  const { t } = useI18n();
  return (
    <div className="space-y-1.5">
      <label className="ui-label block" htmlFor={id}>
        {t("serversPage.syncTargetAuth.label")}
      </label>
      <select id={id} name="syncTargetAuth" defaultValue={defaultValue} className={UI_INPUT}>
        <option value="inherit">{t("serversPage.syncTargetAuth.inherit")}</option>
        <option value="credential">{t("serversPage.syncTargetAuth.credential")}</option>
        <option value="one-time-key">{t("serversPage.syncTargetAuth.oneTimeKey")}</option>
      </select>
      <p className="text-xs leading-5 text-[var(--text-muted)]">{t("serversPage.syncTargetAuth.hint")}</p>
    </div>
  );
}
