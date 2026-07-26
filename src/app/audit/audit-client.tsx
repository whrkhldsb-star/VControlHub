"use client";

import { useCallback } from "react";
import { useUrlQueryState } from "@/lib/hooks/use-url-query-state";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { EmptyState, ListPanel, Toolbar } from "@/components/page-shell";
import { CONTROL_CLASS } from "@/components/ui-primitives";
import { getErrorMessage } from "@/lib/http/error-message";
import { useResourcePolling } from "@/lib/http/use-resource-polling";
import { toDateLocale } from "@/lib/i18n/locale-format";
import { useI18n } from "@/lib/i18n/use-locale";
import { ActionButton } from "@/components/action-button";

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

function formatAction(action: string, t: (k: string, vars?: Record<string, string | number>) => string): string {
  // Historical action aliases that do not match audit.action.<action> keys 1:1.
  const aliases: Record<string, string> = {
    "user.login": "auth.login",
    "alert.evaluate": "alert_rule.evaluate",
  };
  const key = `audit.action.${aliases[action] ?? action}`;
  const translated = t(key);
  return translated !== key ? translated : action;
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
          <ActionButton variant="secondary"
            onClick={fetchLogs}
            data-tone="accent" className="!rounded-full"
          >
            {t("audit.search")}
          </ActionButton>
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
          <ActionButton variant="secondary"
            onClick={fetchLogs}
            data-tone="accent" className="!rounded-full"
          >
            {t("audit.refresh")}
          </ActionButton>
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
          <ActionButton variant="danger" onClick={fetchLogs} className="shrink-0 !px-3 !py-1 !text-xs">
            {t("common.retry")}
          </ActionButton>
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
          ) : error && !data ? (
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
            onClick={() => setPage(Math.max(1, page - 1))}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:bg-[var(--surface-subtle)] disabled:opacity-30"
          >
            {t("audit.pagination.prev")}
          </button>
          <span className="text-sm text-[var(--text-muted)]">
            {t("audit.pagination.info", { page: data.page, totalPages: data.totalPages, total: data.total })}
          </span>
          <button
            type="button"
            disabled={page >= data.totalPages}
            onClick={() => setPage(page + 1)}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:bg-[var(--surface-subtle)] disabled:opacity-30"
          >
            {t("audit.pagination.next")}
          </button>
        </div>
      )}
    </div>
  );
}
