"use client";

import { useState, useCallback } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { EmptyState } from "@/components/page-shell";
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

function severityTone(severity: string): "accent" | "warning" | "danger" {
  const tones: Record<string, "accent" | "warning" | "danger"> = {
    INFO: "accent",
    WARNING: "warning",
    CRITICAL: "danger",
  };
  return tones[severity] ?? tones.INFO!;
}

function formatAction(action: string, t: (k: string) => string): string {
  const labels: Record<string, string> = {
    "auth.login": t("audit.action.auth.login"),
    "auth.login_failed": t("audit.action.auth.login_failed"),
    "auth.login_rate_limited": t("audit.action.auth.login_rate_limited"),
    "auth.password_change": t("audit.action.auth.password_change"),
    "auth.signout": t("audit.action.auth.signout"),
    "api_token.create": t("audit.action.api_token.create"),
    "docker.container_restart": t("audit.action.docker.container_restart"),
    "user.permission_update": t("audit.action.user.permission_update"),
    "storage.file_delete": t("audit.action.storage.file_delete"),
    "storage.file_upload": t("audit.action.storage.file_upload"),
    "storage.file_move": t("audit.action.storage.file_move"),
    "storage.file_rename": t("audit.action.storage.file_rename"),
    "server.create": t("audit.action.server.create"),
    "server.update": t("audit.action.server.update"),
    "server.delete": t("audit.action.server.delete"),
    "command.execute": t("audit.action.command.execute"),
    "command.approve": t("audit.action.command.approve"),
    "command.reject": t("audit.action.command.reject"),
    "download.create": t("audit.action.download.create"),
    "download.cancel": t("audit.action.download.cancel"),
  };
  return labels[action] ?? action;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function AuditLogClient({ initialActionFilter = "" }: AuditLogClientProps) {
  const { t, locale } = useI18n();
  const [page, setPage] = useState(1);
  const [severityFilter, setSeverityFilter] = useState("");
  const [actionFilter, setActionFilter] = useState(initialActionFilter);
  const [searchQuery, setSearchQuery] = useState("");

  const fetchAudit = useCallback(async (): Promise<AuditListResponse> => {
    const params = new URLSearchParams({ page: String(page), pageSize: "50" });
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
      {/* Filters */}
      <div className="mb-6 space-y-3">
        <div className="flex flex-wrap gap-3">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(1);
            }}
            placeholder={t("audit.search-placeholder")}
            aria-label={t("audit.search-placeholder")}
            className="min-w-[240px] flex-1 rounded-2xl border border-[var(--border)] bg-[var(--input-bg)] px-4 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--color-action-border)]/50 focus:outline-none"
          />
          <button
            type="button"
            onClick={fetchLogs}
            data-tone="accent"
            className="rounded-full border px-4 py-2 text-sm transition"
          >
            {t("audit.search")}
          </button>
          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              setPage(1);
            }}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)]/10 px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:bg-[var(--surface)]/10"
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
            className="rounded-2xl border border-[var(--border)] bg-[var(--input-bg)] px-4 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--color-action-border)]/50 focus:outline-none"
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
            className="rounded-2xl border border-[var(--border)] bg-[var(--input-bg)] px-4 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--color-action-border)]/50 focus:outline-none"
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
            className="rounded-full border px-4 py-2 text-sm transition"
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
              window.open(`/api/audit/export?${params.toString()}`, "_self");
            }}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:bg-[var(--surface)]/10"
          >
            {t("audit.exportCsv")}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {["auth.login", "command.execute", "storage.file_delete", "server.delete", "api_token.create"].map((action) => (
            <button
              key={action}
              type="button"
              onClick={() => {
                setActionFilter(action);
                setPage(1);
              }}
              data-tone={actionFilter === action ? "accent" : undefined}
              className={`rounded-full border px-3 py-1 text-xs transition ${actionFilter === action ? "" : "border-[var(--border)] bg-[var(--surface)]/10 text-[var(--text-secondary)] hover:bg-[var(--surface)]/10"}`}
            >
              {formatAction(action, t)}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div role="alert" data-tone="rose" className="mb-4 rounded-2xl border border-[var(--danger-border)] px-4 py-3 text-sm text-[var(--danger)]">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-[var(--border)]">
        {/* Desktop */}
        <div className="hidden md:block">
          <div className="grid grid-cols-[140px_100px_120px_minmax(0,1.5fr)_minmax(0,2fr)_160px] bg-[var(--surface)]/10 px-4 py-3 text-xs uppercase tracking-[0.2em] text-[var(--text-muted)]">
            <div>{t("audit.header.time")}</div>
            <div>{t("audit.header.level")}</div>
            <div>{t("audit.header.type")}</div>
            <div>{t("audit.header.actor")}</div>
            <div>{t("audit.details")}</div>
            <div>{t("audit.source")}</div>
          </div>
          <div className="divide-y divide-[var(--border)] bg-[var(--surface-subtle)]">
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
                    {new Date(log.createdAt).toLocaleString(toDateLocale(locale), { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
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
                    {Object.entries(log.detail).map(([k, v]) => `${k}=${String(v)}`).join(", ")}
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">{log.actorType}</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Mobile */}
        <div className="md:hidden divide-y divide-[var(--border)] bg-[var(--surface-subtle)]">
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
                  {Object.entries(log.detail).map(([k, v]) => `${k}=${String(v)}`).join(", ")}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)]/10 px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:bg-[var(--surface)]/10 disabled:opacity-30"
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
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)]/10 px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:bg-[var(--surface)]/10 disabled:opacity-30"
          >
            {t("audit.pagination.next")}
          </button>
        </div>
      )}
    </div>
  );
}
