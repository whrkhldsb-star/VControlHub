"use client";

import Link from "next/link";

import { EmptyState, StatCard } from "@/components/page-shell";
import { useLocalizedText } from "@/components/localized-text";

type DashboardServerSummary = {
  total: number;
  enabled: number;
  disabled: number;
  sshKey: number;
  directGateway: number;
};

type DashboardStorageSummary = {
  serverTotal: number;
  serverEnabled: number;
  totalNodes: number;
  totalEntries: number;
};

type DashboardQueueSummary = {
  pendingApprovals: number;
  downloads: {
    running: number;
    completed: number;
    failed: number;
  };
  unreadNotifications: number;
  activeScheduledTasks: number;
};

type DashboardQuickLinksProps = DashboardQueueSummary;

export function DashboardLocalizedHeader({ username }: { username: string }) {
  const title = useLocalizedText("dashboard.title", "仪表盘");
  const currentUser = useLocalizedText("dashboard.current-user", "当前用户");
  return (
    <header className="mb-10">
      <h1 className="text-3xl font-semibold tracking-tight text-white light:text-slate-900">{title}</h1>
      <p className="mt-1.5 text-sm text-slate-500">{currentUser}: {username}</p>
    </header>
  );
}

export function DashboardServerHero({ summary }: { summary: DashboardServerSummary }) {
  const eyebrow = useLocalizedText("dashboard.server-overview", "VPS 状态总览");
  const onlineSuffix = useLocalizedText("dashboard.online-vps-suffix", "台在线 VPS");
  const managedPrefix = useLocalizedText("dashboard.managed-nodes-prefix", "共");
  const managedSuffix = useLocalizedText("dashboard.managed-nodes-suffix", "台纳管节点");
  const sshSuffix = useLocalizedText("dashboard.ssh-bound-suffix", "台绑定 SSH 密钥");
  const gatewaySuffix = useLocalizedText("dashboard.direct-gateway-online-suffix", "台直连网关在线");
  const cta = useLocalizedText("dashboard.manage-vps-keys", "管理 VPS 与密钥 →");
  const onlineLabel = useLocalizedText("dashboard.online-vps", "在线 VPS");
  const disabledLabel = useLocalizedText("dashboard.offline-disabled", "离线/停用");
  const sshLabel = useLocalizedText("dashboard.ssh-key-bound", "SSH 密钥绑定");

  return (
    <section data-dashboard-widget="server-status" className="mb-8 rounded-2xl border border-cyan-400/15 bg-cyan-400/[0.04] p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-cyan-300 light:text-cyan-700/70">{eyebrow}</p>
          <h2 className="mt-2 text-2xl font-semibold text-white light:text-slate-900">{summary.enabled} {onlineSuffix}</h2>
          <p className="mt-1 text-sm text-slate-400 light:text-slate-600">
            {managedPrefix} {summary.total} {managedSuffix}, {summary.sshKey} {sshSuffix}, {summary.directGateway} {gatewaySuffix}.
          </p>
        </div>
        <Link href="/servers" className="rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-sm font-medium text-cyan-100 light:text-cyan-900 transition hover:bg-cyan-400/15">
          {cta}
        </Link>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={onlineLabel} value={String(summary.enabled)} accent={summary.enabled > 0} accentColor="cyan" />
        <StatCard label={disabledLabel} value={String(summary.disabled)} accent={summary.disabled > 0} accentColor="amber" />
        <StatCard label={sshLabel} value={`${summary.sshKey}/${summary.total}`} accent={summary.sshKey > 0} />
        <StatCard label="Direct Gateway" value={String(summary.directGateway)} accent={summary.directGateway > 0} accentColor="cyan" />
      </div>
    </section>
  );
}

export function DashboardStatsSection({ storage, queue }: { storage: DashboardStorageSummary; queue: DashboardQueueSummary }) {
  const coreTitle = useLocalizedText("dashboard.core-resources", "核心资源");
  const queueTitle = useLocalizedText("dashboard.ops-queue", "运维队列");
  const vpsNodes = useLocalizedText("dashboard.vps-nodes", "VPS 节点");
  const enabledNodes = useLocalizedText("dashboard.enabled-nodes", "启用节点");
  const storageNodes = useLocalizedText("dashboard.storage-nodes", "存储节点");
  const fileEntries = useLocalizedText("dashboard.file-entries", "文件条目");
  const pending = useLocalizedText("dashboard.pending-approvals", "待审批");
  const downloads = useLocalizedText("dashboard.download-tasks", "下载任务");
  const running = useLocalizedText("dashboard.running", "运行中");
  const completed = useLocalizedText("dashboard.completed", "完成");
  const failed = useLocalizedText("dashboard.failed", "失败");
  const notificationScheduled = useLocalizedText("dashboard.notifications-scheduled", "通知/定时");
  const unread = useLocalizedText("dashboard.unread", "未读");
  const active = useLocalizedText("dashboard.active", "活跃");

  const downloadValue = queue.downloads.running > 0 ? `${queue.downloads.running} ${running}` : String(queue.downloads.running + queue.downloads.completed + queue.downloads.failed);
  const downloadDetail = queue.downloads.running > 0 ? `${queue.downloads.running} ${running} / ${queue.downloads.completed} ${completed} / ${queue.downloads.failed} ${failed}` : undefined;

  return (
    <section data-dashboard-widget="server-status" className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
        <h2 className="text-sm font-medium text-white light:text-slate-900/80">{coreTitle}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-2">
          <StatCard label={vpsNodes} value={String(storage.serverTotal)} accent={false} />
          <StatCard label={enabledNodes} value={String(storage.serverEnabled)} accent={false} />
          <StatCard label={storageNodes} value={String(storage.totalNodes)} accent={false} />
          <StatCard label={fileEntries} value={String(storage.totalEntries)} accent={false} />
        </div>
      </div>
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
        <h2 className="text-sm font-medium text-white light:text-slate-900/80">{queueTitle}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <StatCard label={pending} value={String(queue.pendingApprovals)} accent={queue.pendingApprovals > 0} accentColor="amber" />
          <StatCard label={downloads} value={downloadValue} accent={queue.downloads.running > 0} accentColor="cyan" detail={downloadDetail} />
          <StatCard label={notificationScheduled} value={`${queue.unreadNotifications} ${unread} / ${queue.activeScheduledTasks} ${active}`} accent={queue.unreadNotifications > 0 || queue.activeScheduledTasks > 0} accentColor={queue.unreadNotifications > 0 ? "amber" : "cyan"} />
        </div>
      </div>
    </section>
  );
}

export function DashboardQuickLinks({ pendingApprovals, downloads, unreadNotifications, activeScheduledTasks }: DashboardQuickLinksProps) {
  const labels = {
    servers: useLocalizedText("dashboard.quick.servers", "VPS 管理"),
    serversDesc: useLocalizedText("dashboard.quick.servers-desc", "节点纳管、SSH 密钥与命令分发"),
    files: useLocalizedText("dashboard.quick.files", "文件管理"),
    filesDesc: useLocalizedText("dashboard.quick.files-desc", "文件浏览、上传下载与存储节点管理"),
    downloads: useLocalizedText("dashboard.quick.downloads", "远程下载"),
    downloadsDesc: useLocalizedText("dashboard.quick.downloads-desc", "URL/磁力链接下载到指定 VPS"),
    approvals: useLocalizedText("dashboard.quick.approvals", "审批中心"),
    approvalsDesc: useLocalizedText("dashboard.quick.approvals-desc", "命令审批与执行日志"),
    scheduled: useLocalizedText("dashboard.quick.scheduled", "定时任务"),
    scheduledDesc: useLocalizedText("dashboard.quick.scheduled-desc", "Cron 调度与自动化命令下发"),
    notifications: useLocalizedText("dashboard.quick.notifications", "通知中心"),
    notificationsDesc: useLocalizedText("dashboard.quick.notifications-desc", "系统告警与操作通知"),
    running: useLocalizedText("dashboard.running", "运行中"),
    pending: useLocalizedText("dashboard.pending-approvals", "待审批"),
    active: useLocalizedText("dashboard.active", "活跃"),
    unread: useLocalizedText("dashboard.unread", "未读"),
  };

  return (
    <section data-dashboard-widget="quick-links" className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
      <QuickLink href="/servers" title={labels.servers} desc={labels.serversDesc} icon={<ServerIcon />} />
      <QuickLink href="/files" title={labels.files} desc={labels.filesDesc} icon={<FilesIcon />} />
      <QuickLink href="/downloads" title={labels.downloads} desc={labels.downloadsDesc} icon={<DownloadsIcon />} badge={downloads.running > 0 ? `${downloads.running} ${labels.running}` : undefined} badgeColor="cyan" />
      <QuickLink href="/requests" title={labels.approvals} desc={labels.approvalsDesc} icon={<ApprovalsIcon />} badge={pendingApprovals > 0 ? `${pendingApprovals} ${labels.pending}` : undefined} badgeColor="amber" />
      <QuickLink href="/scheduled-tasks" title={labels.scheduled} desc={labels.scheduledDesc} icon={<ScheduledIcon />} badge={activeScheduledTasks > 0 ? `${activeScheduledTasks} ${labels.active}` : undefined} badgeColor="cyan" />
      <QuickLink href="/notifications" title={labels.notifications} desc={labels.notificationsDesc} icon={<NotificationsIcon />} badge={unreadNotifications > 0 ? `${unreadNotifications} ${labels.unread}` : undefined} badgeColor="amber" />
    </section>
  );
}

type DashboardAuditLog = {
  id: string;
  action: string;
  severity: "INFO" | "WARNING" | "CRITICAL" | string;
  actorType: string;
  actor?: { username: string; displayName: string | null } | null;
  createdAt: string;
  formattedCreatedAt: string;
};

type DashboardCommandRequest = {
  id: string;
  title: string;
  command: string;
  status: string;
  approvalStateLabel: string;
  isAssistantInitiated: boolean;
  requester: { username: string; displayName: string | null };
  targetCount: number;
};

export function DashboardRecentActivity({ recentRequests, recentAuditLogs }: { recentRequests: DashboardCommandRequest[]; recentAuditLogs: DashboardAuditLog[] }) {
  const approvalsTitle = useLocalizedText("dashboard.recent-approvals", "最近审批活动");
  const auditTitle = useLocalizedText("dashboard.recent-audit", "最近操作日志");
  const noRequests = useLocalizedText("dashboard.no-command-requests", "暂无命令请求记录。");
  const noAudit = useLocalizedText("dashboard.no-audit-logs", "暂无审计日志。");
  const assistant = useLocalizedText("dashboard.actor-assistant", "助手");
  const user = useLocalizedText("dashboard.actor-user", "用户");
  const targetPrefix = useLocalizedText("dashboard.target-prefix", "目标");
  const targetSuffix = useLocalizedText("dashboard.target-suffix", "台");
  const viewAll = useLocalizedText("dashboard.view-all", "查看全部 →");

  return (
    <section data-dashboard-widget="audit-log" className="mt-8 grid gap-6 lg:grid-cols-2">
      <div>
        <h2 className="text-lg font-semibold text-white light:text-slate-900 mb-4">{approvalsTitle}</h2>
        {recentRequests.length === 0 ? (
          <EmptyState text={noRequests} />
        ) : (
          <div className="space-y-2.5">
            {recentRequests.map((request) => (
              <article key={request.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 hover:bg-white/[0.04] transition-colors duration-150">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium text-white light:text-slate-900 text-sm truncate">{request.title}</h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {request.requester.displayName || request.requester.username}
                      {request.isAssistantInitiated ? ` · ${assistant}` : ` · ${user}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge color={request.status === "PENDING_APPROVAL" ? "amber" : request.status === "APPROVED" ? "emerald" : "slate"}>{request.approvalStateLabel}</Badge>
                    <Badge color="slate">{targetPrefix} {request.targetCount} {targetSuffix}</Badge>
                  </div>
                </div>
                <p className="mt-2.5 rounded-lg bg-slate-950/60 light:bg-white/60 px-3 py-1.5 font-mono text-xs text-cyan-100/80 light:text-cyan-900/80 border border-white/[0.04]">{request.command}</p>
              </article>
            ))}
          </div>
        )}
      </div>
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white light:text-slate-900">{auditTitle}</h2>
          <Link href="/audit" className="text-xs text-cyan-400/80 hover:text-cyan-300 transition-colors">{viewAll}</Link>
        </div>
        {recentAuditLogs.length === 0 ? (
          <EmptyState text={noAudit} />
        ) : (
          <div className="space-y-1.5">
            {recentAuditLogs.map((log) => (
              <div key={log.id} className="rounded-lg border border-white/[0.04] bg-white/[0.02] px-3.5 py-2.5 hover:bg-white/[0.04] transition-colors duration-150">
                <div className="flex items-center gap-2 text-xs">
                  <Badge color={log.severity === "WARNING" ? "amber" : log.severity === "CRITICAL" ? "rose" : "slate"}>{log.action}</Badge>
                  <span className="text-slate-500 truncate">{log.actor?.displayName ?? log.actor?.username ?? (log.actorType === "SYSTEM" ? "系统" : log.actorType)}</span>
                  <time className="ml-auto text-slate-600 shrink-0" dateTime={log.createdAt} suppressHydrationWarning>{log.formattedCreatedAt}</time>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function QuickLink({ href, title, desc, icon, badge, badgeColor }: { href: string; title: string; desc: string; icon: React.ReactNode; badge?: string; badgeColor?: "cyan" | "amber" }) {
  const badgeBg = badgeColor === "cyan" ? "bg-cyan-400/10 border-cyan-400/20 text-cyan-200" : "bg-amber-400/10 border-amber-400/20 text-amber-200";
  return (
    <Link href={href} className="group rounded-xl border border-white/[0.06] bg-white/[0.03] p-5 transition-all duration-150 hover:border-cyan-400/20 hover:bg-cyan-400/[0.04]">
      <div className="text-slate-400 light:text-slate-600 group-hover:text-cyan-300 transition-colors duration-150">{icon}</div>
      <div className="mt-3 text-sm font-medium text-white light:text-slate-900">{title}</div>
      <p className="mt-1 text-xs text-slate-500">{desc}</p>
      {badge && <span className={`mt-2.5 inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${badgeBg}`}>{badge}</span>}
    </Link>
  );
}

function Badge({ color, children }: { color: "amber" | "emerald" | "rose" | "slate"; children: React.ReactNode }) {
  const styles = {
    amber: "border-amber-400/20 bg-amber-400/10 text-amber-200",
    emerald: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
    rose: "border-rose-400/20 bg-rose-400/10 text-rose-200",
    slate: "border-white/10 bg-white/5 text-slate-300",
  };
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${styles[color]}`}>{children}</span>;
}

function ServerIcon() { return <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" /></svg>; }
function FilesIcon() { return <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>; }
function DownloadsIcon() { return <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>; }
function ApprovalsIcon() { return <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>; }
function ScheduledIcon() { return <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>; }
function NotificationsIcon() { return <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>; }
