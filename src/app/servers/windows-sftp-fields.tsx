"use client";

import { useState } from "react";
import { UI_INPUT } from "@/lib/ui/classes";
import { useI18n } from "@/lib/i18n/use-locale";

export function WindowsSftpFields({
  editing = false,
  configured = false,
  port = 22,
  username = "",
  basePath = "/C:/VControlHub/Files",
}: {
  editing?: boolean;
  configured?: boolean;
  port?: number;
  username?: string;
  basePath?: string;
}) {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(configured);
  return <section data-inset className="p-4 space-y-3">
    <label className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
      <input name="windowsSftpEnabled" type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.currentTarget.checked)} className="h-4 w-4 accent-[var(--accent)]" />
      {t("serversPage.windows.sftpTitle")}
    </label>
    <p className="text-xs leading-5 text-[var(--text-muted)]">{t("serversPage.windows.sftpHint")}</p>
    {enabled ? <div className="grid gap-3 sm:grid-cols-2">
      <label className="ui-label space-y-1.5">{t("serversPage.windows.sftpPort")}
        <input name="windowsSftpPort" type="number" min={1} max={65535} defaultValue={port} required className={UI_INPUT} />
      </label>
      <label className="ui-label space-y-1.5">{t("serversPage.windows.sftpUsername")}
        <input name="windowsSftpUsername" type="text" defaultValue={username} required className={UI_INPUT} autoComplete="username" />
      </label>
      <label className="ui-label space-y-1.5">{t("serversPage.windows.sftpPassword")}
        <input name="windowsSftpPassword" type="password" required={!editing || !configured} className={UI_INPUT} autoComplete="new-password" />
      </label>
      <label className="ui-label space-y-1.5">{t("serversPage.windows.sftpPath")}
        <input name="windowsSftpPath" type="text" defaultValue={basePath} required placeholder="/C:/VControlHub/Files" className={UI_INPUT} />
      </label>
    </div> : null}
    {editing && configured && !enabled ? <p className="text-xs text-[var(--warning)]">{t("serversPage.windows.sftpDisableHint")}</p> : null}
  </section>;
}
