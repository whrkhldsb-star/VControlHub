"use client";

import { useState, useEffect, useCallback } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { EmptyState } from "@/components/page-shell";

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
  return tones[severity] ?? tones.INFO;
}

function formatAction(action: string): string {
  const labels: Record<string, string> = {
    "auth.login": "登录",
    "auth.login_failed": "登录失败",
    "auth.login_rate_limited": "登录限速",
    "auth.password_change": "修改密码",
    "auth.signout": "退出登录",
    "api_token.create": "创建令牌",
    "docker.container_restart": "重启容器",
    "user.permission_update": "调整权限",
    "storage.file_delete": "删除文件",
    "storage.file_upload": "上传文件",
    "storage.file_move": "移动文件",
    "storage.file_rename": "重命名文件",
    "server.create": "创建节点",
    "server.update": "更新节点",
    "server.delete": "删除节点",
    "command.execute": "执行命令",
    "command.approve": "审批命令",
    "command.reject": "拒绝命令",
    "download.create": "创建下载任务",
    "download.cancel": "取消下载",
  };
  return labels[action] ?? action;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function AuditLogClient({ initialActionFilter = "" }: AuditLogClientProps) {
  const [data, setData] = useState<AuditListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [severityFilter, setSeverityFilter] = useState("");
  const [actionFilter, setActionFilter] = useState(initialActionFilter);
  const [searchQuery, setSearchQuery] = useState("");

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "50" });
      if (severityFilter) params.set("severity", severityFilter);
      if (actionFilter) params.set("action", actionFilter);
      if (searchQuery.trim()) params.set("search", searchQuery.trim());
      const json = await csrfFetch(`/api/audit?${params}`);
      setData(json as AuditListResponse);
      setError(null);
    } catch (error) {
      setError(getErrorMessage(error, "审计日志加载失败"));
    } finally {
      setLoading(false);
    }
  }, [page, severityFilter, actionFilter, searchQuery]);

	/* eslint-disable react-hooks/set-state-in-effect */
	useEffect(() => {
		fetchLogs();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [page, severityFilter, actionFilter, searchQuery]);
	/* eslint-enable react-hooks/set-state-in-effect */

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
            placeholder="搜索动作、用户名或显示名"
            className="min-w-[240px] flex-1 rounded-2xl border border-[var(--border)] bg-slate-950 px-4 py-2 text-sm text-white placeholder:text-slate-500 light:placeholder:text-slate-400 focus:border-cyan-400/50 focus:outline-none"
          />
          <button
            type="button"
            onClick={fetchLogs}
            data-tone="accent"
            className="rounded-full border px-4 py-2 text-sm transition"
          >
            搜索
          </button>
          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              setPage(1);
            }}
            className="rounded-full border border-[var(--border)] bg-white/5 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/10"
          >
            清除
          </button>
        </div>
        <div className="flex flex-wrap gap-3">
          <select
            value={severityFilter}
            onChange={(e) => {
              setSeverityFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-2xl border border-[var(--border)] bg-slate-950 px-4 py-2 text-sm text-white focus:border-cyan-400/50 focus:outline-none"
          >
            <option value="">全部级别</option>
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
            className="rounded-2xl border border-[var(--border)] bg-slate-950 px-4 py-2 text-sm text-white focus:border-cyan-400/50 focus:outline-none"
          >
            <option value="">全部类型</option>
            <option value="auth.login">登录</option>
            <option value="auth.login_failed">登录失败</option>
            <option value="auth.password_change">修改密码</option>
            <option value="storage.file_delete">删除文件</option>
            <option value="server.create">创建节点</option>
            <option value="command.execute">执行命令</option>
            <option value="download.create">创建下载</option>
          </select>
          <button
            type="button"
            onClick={fetchLogs}
            data-tone="accent"
            className="rounded-full border px-4 py-2 text-sm transition"
          >
            ↻ 刷新
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
              className={`rounded-full border px-3 py-1 text-xs transition ${actionFilter === action ? "" : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"}`}
            >
              {formatAction(action)}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-2xl border border-rose-400/30 bg-rose-400/5 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-[var(--border)]">
        {/* Desktop */}
        <div className="hidden md:block">
          <div className="grid grid-cols-[140px_100px_120px_minmax(0,1.5fr)_minmax(0,2fr)_160px] bg-white/5 px-4 py-3 text-xs uppercase tracking-[0.2em] text-slate-400">
            <div>时间</div>
            <div>级别</div>
            <div>类型</div>
            <div>操作者</div>
            <div>详情</div>
            <div>来源</div>
          </div>
          <div className="divide-y divide-white/5 bg-slate-950/40">
            {loading ? (
              <EmptyState>加载中…</EmptyState>
            ) : error && !data ? (
              <div className="px-4 py-10 text-sm text-rose-200">审计日志加载失败，请稍后重试。</div>
            ) : !data || data.logs.length === 0 ? (
              <EmptyState>暂无审计日志。</EmptyState>
            ) : (
              data.logs.map((log) => (
                <div key={log.id} className="grid grid-cols-[140px_100px_120px_minmax(0,1.5fr)_minmax(0,2fr)_160px] items-center gap-4 px-4 py-3 text-sm">
                  <div className="text-xs text-slate-400">
                    {new Date(log.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </div>
                  <div>
                    <span data-tone={severityTone(log.severity)} className="rounded-full border px-2 py-0.5 text-[10px] font-medium">
                      {log.severity}
                    </span>
                  </div>
                  <div className="text-white">{formatAction(log.action)}</div>
                  <div className="text-slate-300 truncate">
                    {log.actor ? (log.actor.displayName ?? log.actor.username) : log.actorType}
                  </div>
                  <div className="text-xs text-slate-400 truncate font-mono">
                    {Object.entries(log.detail).map(([k, v]) => `${k}=${String(v)}`).join(", ")}
                  </div>
                  <div className="text-xs text-slate-500">{log.actorType}</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Mobile */}
        <div className="md:hidden divide-y divide-white/5 bg-slate-950/40">
          {loading ? (
            <EmptyState>加载中…</EmptyState>
          ) : error && !data ? (
            <div className="px-4 py-10 text-sm text-rose-200">审计日志加载失败，请稍后重试。</div>
          ) : !data || data.logs.length === 0 ? (
            <EmptyState>暂无审计日志。</EmptyState>
          ) : (
            data.logs.map((log) => (
              <div key={log.id} className="px-4 py-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-white text-sm">{formatAction(log.action)}</span>
                  <span data-tone={severityTone(log.severity)} className="rounded-full border px-2 py-0.5 text-[10px] font-medium">
                    {log.severity}
                  </span>
                </div>
                <div className="text-xs text-slate-400">
                  {log.actor ? (log.actor.displayName ?? log.actor.username) : log.actorType} · {new Date(log.createdAt).toLocaleString("zh-CN")}
                </div>
                <div className="text-xs text-slate-500 font-mono truncate">
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
            className="rounded-full border border-[var(--border)] bg-white/5 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/10 disabled:opacity-30"
          >
            ← 上一页
          </button>
          <span className="text-sm text-slate-400">
            第 {data.page} / {data.totalPages} 页 · 共 {data.total} 条
          </span>
          <button
            type="button"
            disabled={page >= data.totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-full border border-[var(--border)] bg-white/5 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/10 disabled:opacity-30"
          >
            下一页 →
          </button>
        </div>
      )}
    </div>
  );
}
