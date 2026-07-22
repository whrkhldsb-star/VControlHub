"use client";

import { useState, useCallback } from "react";
import { useUrlQueryState } from "@/lib/hooks/use-url-query-state";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { EmptyState, ListPanel, Toolbar } from "@/components/page-shell";
import { CONTROL_CLASS } from "@/components/ui-primitives";
import { useResourcePolling } from "@/lib/http/use-resource-polling";
import { toDateLocale } from "@/lib/i18n/locale-format";
import { useI18n } from "@/lib/i18n/use-locale";

type AuditLog = {
  id: string;
  actorType: string;
  actorId: string | null;
  action: string;
  severity: string;
  detail: Record<string, unknown>;
  createdAt: string;
  actor: { username: string; displayName: string | null } | null;
};

type AuditListResponse = {
  logs: AuditLog[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

type AuditLogClientProps = {
  initialActionFilter?: string;
};

function severityTone(severity: string):"accent" |"warning" |"danger" {
  const tones: Record<string,"accent" |"warning" |"danger"> = {
    INFO:"accent",
    WARNING:"warning",
    CRITICAL:"danger",
  };
  return tones[severity] ?? tones.INFO!;
}

function formatAction(action: string, t: (k: string) => string): string {
  const labels: Record<string, string> = {"auth.login": t("audit.action.auth.login"),"auth.login_password_ok": t("audit.action.auth.login_password_ok"),"auth.login_2fa_ok": t("audit.action.auth.login_2fa_ok"),"auth.login_failed": t("audit.action.auth.login_failed"),"auth.login_rate_limited": t("audit.action.auth.login_rate_limited"),"auth.password_change": t("audit.action.auth.password_change"),"auth.signout": t("audit.action.auth.signout"),"user.login": t("audit.action.auth.login"),"user.create": t("audit.action.user.create"),"user.disable": t("audit.action.user.disable"),"user.enable": t("audit.action.user.enable"),"user.role_update": t("audit.action.user.role_update"),"api_token.create": t("audit.action.api_token.create"),"api_token.revoke": t("audit.action.api_token.revoke"),"docker.container_restart": t("audit.action.docker.container_restart"),"user.permission_update": t("audit.action.user.permission_update"),"storage.file_delete": t("audit.action.storage.file_delete"),"storage.file_upload": t("audit.action.storage.file_upload"),"storage.file_move": t("audit.action.storage.file_move"),"storage.file_rename": t("audit.action.storage.file_rename"),"server.create": t("audit.action.server.create"),"server.update": t("audit.action.server.update"),"server.delete": t("audit.action.server.delete"),"server.detect_os": t("audit.action.server.detect_os"),"server.detect_os_error": t("audit.action.server.detect_os_error"),"command.execute": t("audit.action.command.execute"),"command.execute.completed": t("audit.action.command.execute.completed"),"command.execute.failed": t("audit.action.command.execute.failed"),"command.approve": t("audit.action.command.approve"),"command.reject": t("audit.action.command.reject"),"command.submit": t("audit.action.command.submit"),"command.cancel": t("audit.action.command.cancel"),"command_template.create": t("audit.action.command_template.create"),"command_template.update": t("audit.action.command_template.update"),"command_template.delete": t("audit.action.command_template.delete"),"download.create": t("audit.action.download.create"),"download.cancel": t("audit.action.download.cancel"),"download.purge": t("audit.action.download.purge"),"download.dispatch_failed": t("audit.action.download.dispatch_failed"),"alert.evaluate": t("audit.action.alert_rule.evaluate"),"alert_rule.toggle": t("audit.action.alert_rule.toggle"),"alert_rule.test": t("audit.action.alert_rule.test"),"alert_rule.delete": t("audit.action.alert_rule.delete"),"alert_rule.evaluate": t("audit.action.alert_rule.evaluate"),"deploy.rollback": t("audit.action.deploy.rollback"),"deployment.create": t("audit.action.deployment.create"),"deployment.export.download": t("audit.action.deployment.export.download"),"settings.update": t("audit.action.settings.update"),"playbook.create": t("audit.action.playbook.create"),"playbook.update": t("audit.action.playbook.update"),"playbook.delete": t("audit.action.playbook.delete"),"playbook.run": t("audit.action.playbook.run"),"playbook.run.completed": t("audit.action.playbook.run.completed"),"playbook.run.failed": t("audit.action.playbook.run.failed"),"vps-backup.schedule.update": t("audit.action.vps-backup.schedule.update"),"vps-backup.schedule.delete": t("audit.action.vps-backup.schedule.delete"),"vps-backup.record.delete": t("audit.action.vps-backup.record.delete"),"system.import.preview": t("audit.action.system.import.preview"),"system.import": t("audit.action.system.import"),"system.export": t("audit.action.system.export"),"cost.create": t("audit.action.cost.create"),"cost.update": t("audit.action.cost.update"),"cost.delete": t("audit.action.cost.delete"),"team.create": t("audit.action.team.create"),"team.switch": t("audit.action.team.switch"),"team.member.upsert": t("audit.action.team.member.upsert"),"team.member.remove": t("audit.action.team.member.remove"),"team.update": t("audit.action.team.update"),"team.delete": t("audit.action.team.delete"),"quick_service.install.started": t("audit.action.quick_service.install.started"),"quick_service.install.succeeded": t("audit.action.quick_service.install.succeeded"),"quick_service.install.failed": t("audit.action.quick_service.install.failed"),"quick_service.uninstall.started": t("audit.action.quick_service.uninstall.started"),"quick_service.uninstall.succeeded": t("audit.action.quick_service.uninstall.succeeded"),"quick_service.uninstall.failed": t("audit.action.quick_service.uninstall.failed"),"quick_service.start.started": t("audit.action.quick_service.start.started"),"quick_service.start.succeeded": t("audit.action.quick_service.start.succeeded"),"quick_service.stop.started": t("audit.action.quick_service.stop.started"),"quick_service.stop.succeeded": t("audit.action.quick_service.stop.succeeded"),"quick_service.sync.started": t("audit.action.quick_service.sync.started"),"quick_service.sync.succeeded": t("audit.action.quick_service.sync.succeeded"),"quick_service.update.started": t("audit.action.quick_service.update.started"),"quick_service.update.succeeded": t("audit.action.quick_service.update.succeeded"),"quick_service.update.failed": t("audit.action.quick_service.update.failed"),"reset_password": t("audit.action.reset_password"),"create": t("audit.action.create"),"delete": t("audit.action.delete"),"update": t("audit.action.update"),"start": t("audit.action.start"),"stop": t("audit.action.stop"),"restart": t("audit.action.restart"),"pause": t("audit.action.pause"),"resume": t("audit.action.resume"),"toggle": t("audit.action.toggle"),"read": t("audit.action.read"),"write": t("audit.action.write"),"refresh": t("audit.action.refresh"),"sync": t("audit.action.sync"),"install": t("audit.action.install"),"uninstall": t("audit.action.uninstall"),"rename": t("audit.action.rename"),"remove": t("audit.action.remove"),"purge": t("audit.action.purge"),"destroy": t("audit.action.destroy"),"approve": t("audit.action.approve"),"reject": t("audit.action.reject"),"cancel": t("audit.action.cancel"),"confirm": t("audit.action.confirm"),"skip": t("audit.action.skip"),"status": t("audit.action.status"),"desc": t("audit.action.desc"),"moveAlbum": t("audit.action.moveAlbum"),
  };
  return labels[action] ?? action;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function AuditLogClient({ initialActionFilter = "" }: AuditLogClientProps) {
  const { t, locale } = useI18n();
  const { state: urlState, setField: setUrlField, patch: patchUrl } = useUrlQueryState({
    page: "1",
    severity: "",
    action: initialActionFilter || "",
    q: "",
  });
  const page = Math.max(1, Number.parseInt(urlState.page || "1", 10) || 1);
  const setPage = (value: number) => setUrlField("page", String(Math.max(1, value)));
  const severityFilter = urlState.severity || "";
  const setSeverityFilter = (value: string) => {
    patchUrl({ severity: value, page: "1" });
  };
  const actionFilter = urlState.action || "";
  const setActionFilter = (value: string) => {
    patchUrl({ action: value, page: "1" });
  };
  const searchQuery = urlState.q || "";
  const setSearchQuery = (value: string) => {
    patchUrl({ q: value, page: "1" });
  };

  const fetchAudit = useCallback(async (): Promise<AuditListResponse> => {
    const params = new URLSearchParams({ page: String(page), pageSize:"50" });
    if (severityFilter) params.set("severity", severityFilter);
    if (actionFilter) params.set("action", actionFilter);
    if (searchQuery.trim()) params.set("search", searchQuery.trim());
    return (await csrfFetch(`/api/audit?${params}`)) as AuditListResponse;
  }, [page, severityFilter, actionFilter, searchQuery]);

  const getAuditErrorMessage = useCallback(
    (error: unknown) => getErrorMessage(error, t("audit.loadFailed")),
    [t],
  );

  const { data, loading, error, refresh: fetchLogs } = useResourcePolling<AuditListResponse>({
    fetcher: fetchAudit,
    intervalSeconds: 0,
    getErrorMessage: getAuditErrorMessage,
  });

  return (
    <div>
      <Toolbar className="mb-4 flex-col items-stretch gap-3 sm:items-stretch">
        <div className="flex flex-wrap gap-2">
          <input
            type="search"
            data-input
            value={searchQuery}
            aria-label={t("audit.search-placeholder")}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(1);
            }}
            placeholder={t("audit.search-placeholder")}
            className={`${CONTROL_CLASS} min-w-[240px] flex-1`}
          />
          <button
            type="button"
            onClick={fetchLogs}
            data-tone="accent"
            data-action-button data-variant="secondary" className="!rounded-full"
          >
            {t("audit.search")}
          </button>
          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              setPage(1);
            }}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:bg-[var(--surface-subtle)]"
          >
            {t("common.clear")}
          </button>
        </div>
        <div className="flex flex-wrap gap-3">
          <select
            value={severityFilter}
            onChange={(e) => {
              setSeverityFilter(e.target.value);
              setPage(1);
            }}
            aria-label={t("audit.filterBySeverity")}
            className={`${CONTROL_CLASS} !w-auto min-w-[10rem]`}
          >
            <option value="">{t("audit.all-severities")}</option>
            <option value="INFO">INFO</option>
            <option value="WARNING">WARNING</option>
            <option value="CRITICAL">CRITICAL</option>
          </select>
          <select
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value);
              setPage(1);
            }}
            aria-label={t("audit.filterByAction")}
            className={`${CONTROL_CLASS} !w-auto min-w-[10rem]`}
          >
            <option value="">{t("audit.all-types")}</option>
            <option value="auth.login">{t("audit.action.auth.login")}</option>
            <option value="auth.login_failed">{t("audit.action.auth.login_failed")}</option>
            <option value="auth.password_change">{t("audit.action.auth.password_change")}</option>
            <option value="storage.file_delete">{t("audit.action.storage.file_delete")}</option>
            <option value="server.create">{t("audit.create-node")}</option>
            <option value="command.execute">{t("audit.action.command.execute")}</option>
            <option value="download.create">{t("audit.action.download.create")}</option>
          </select>
          <button
            type="button"
            onClick={fetchLogs}
            data-tone="accent"
            data-action-button data-variant="secondary" className="!rounded-full"
          >
            {t("audit.refresh")}
          </button>
          <button
            type="button"
            onClick={() => {
              const params = new URLSearchParams();
              if (severityFilter) params.set("severity", severityFilter);
              if (actionFilter) params.set("action", actionFilter);
              if (searchQuery.trim()) params.set("search", searchQuery.trim());
              window.open(`/api/audit/export?${params.toString()}`,"_self");
            }}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:bg-[var(--surface-subtle)]"
          >
            {t("audit.exportCsv")}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {["auth.login","command.execute","storage.file_delete","server.delete","api_token.create"].map((action) => (
            <button
              key={action}
              type="button"
              onClick={() => {
                setActionFilter(action);
                setPage(1);
              }}
              data-tone={actionFilter === action ?"accent" : undefined}
              className={`rounded-full border px-3 py-1 text-xs transition ${actionFilter === action ?"" :"border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"}`}
            >
              {formatAction(action, t)}
            </button>
          ))}
        </div>
      </Toolbar>

      {error && (
        <div role="alert" data-tone="rose" className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-[var(--danger-border)] px-4 py-3 text-sm text-[var(--danger)]">
          <span>{error}</span>
          <button type="button" onClick={fetchLogs} data-action-button data-variant="danger" className="shrink-0 !px-3 !py-1 !text-xs">
            {t("common.retry")}
          </button>
        </div>
      )}

      <ListPanel title={t("audit.details")} count={data?.total ?? (loading ?"…" : 0)}>
        {/* Desktop */}
        <div className="hidden md:block">
          <div className="grid grid-cols-[140px_100px_120px_minmax(0,1.5fr)_minmax(0,2fr)_160px] border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-4 py-3 text-xs uppercase tracking-[0.14em] text-[var(--text-muted)]">
            <div>{t("audit.header.time")}</div>
            <div>{t("audit.header.level")}</div>
            <div>{t("audit.header.type")}</div>
            <div>{t("audit.header.actor")}</div>
            <div>{t("audit.details")}</div>
            <div>{t("audit.source")}</div>
          </div>
          <div className="divide-y divide-[var(--border-subtle)]">
            {loading ? (
              <EmptyState>{t("audit.loading")}</EmptyState>
            ) : error && !data ? (
              <div className="px-4 py-10 text-sm text-[var(--danger)]">{t("audit.load-error")}</div>
            ) : !data || data.logs.length === 0 ? (
              <EmptyState>{t("audit.empty")}</EmptyState>
            ) : (
              data.logs.map((log) => (
                <div key={log.id} className="grid grid-cols-[140px_100px_120px_minmax(0,1.5fr)_minmax(0,2fr)_160px] items-center gap-4 px-4 py-3 text-sm">
                  <div className="text-xs text-[var(--text-muted)]">
                    {new Date(log.createdAt).toLocaleString(toDateLocale(locale), { month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" })}
                  </div>
                  <div>
                    <span data-tone={severityTone(log.severity)} className="rounded-full border px-2 py-0.5 text-[10px] font-medium">
                      {log.severity}
                    </span>
                  </div>
                  <div className="text-[var(--text-primary)]">{formatAction(log.action, t)}</div>
                  <div className="text-[var(--text-secondary)] truncate">
                    {log.actor ? (log.actor.displayName ?? log.actor.username) : log.actorType}
                  </div>
                  <div className="text-xs text-[var(--text-muted)] truncate font-mono">
                    {Object.entries(log.detail).map(([k, v]) => `${k}=${String(v)}`).join(",")}
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">{log.actorType}</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Mobile */}
        <div className="divide-y divide-[var(--border-subtle)] md:hidden">
          {loading ? (
            <EmptyState>{t("audit.loading")}</EmptyState>
          ) : error ? (
            <div className="px-4 py-10 text-sm text-[var(--danger)]">{t("audit.load-error")}</div>
          ) : !data || data.logs.length === 0 ? (
            <EmptyState>{t("audit.empty")}</EmptyState>
          ) : (
            data.logs.map((log) => (
              <div key={log.id} className="px-4 py-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[var(--text-primary)] text-sm">{formatAction(log.action, t)}</span>
                  <span data-tone={severityTone(log.severity)} className="rounded-full border px-2 py-0.5 text-[10px] font-medium">
                    {log.severity}
                  </span>
                </div>
                <div className="text-xs text-[var(--text-muted)]">
                  {log.actor ? (log.actor.displayName ?? log.actor.username) : log.actorType} · {new Date(log.createdAt).toLocaleString(toDateLocale(locale))}
                </div>
                <div className="text-xs text-[var(--text-muted)] font-mono truncate">
                  {Object.entries(log.detail).map(([k, v]) => `${k}=${String(v)}`).join(",")}
                </div>
              </div>
            ))
          )}
        </div>
      </ListPanel>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:bg-[var(--surface-subtle)] disabled:opacity-30"
          >
            {t("audit.pagination.prev")}
          </button>
          <span className="text-sm text-[var(--text-muted)]">
            {t("audit.pagination.info")
              .replace("{page}", String(data.page))
              .replace("{totalPages}", String(data.totalPages))
              .replace("{total}", String(data.total))}
          </span>
          <button
            type="button"
            disabled={page >= data.totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:bg-[var(--surface-subtle)] disabled:opacity-30"
          >
            {t("audit.pagination.next")}
          </button>
        </div>
      )}
    </div>
  );
}
