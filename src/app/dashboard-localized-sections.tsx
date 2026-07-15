"use client";

import Link from "next/link";

import { EmptyState, StatCard } from "@/components/page-shell";
import { useI18n } from "@/lib/i18n/use-locale";

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
  const { t } = useI18n();
  const title = t("dashboard.title");
  const currentUser = t("dashboard.current-user");
  return (
    <header className="mb-6 border-b border-[var(--border-subtle)] pb-5" data-page-header>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">
        {t("nav.dashboard") === "nav.dashboard" ? "Overview" : t("nav.dashboard")}
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="break-words text-[1.75rem] font-semibold leading-snug tracking-[-0.02em] text-[var(--text-primary)] sm:text-[2rem]">{title}</h1>
          <p className="mt-1.5 text-sm text-[var(--text-muted)]">
            {currentUser}: <span className="font-medium text-[var(--text-secondary)]">{username}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/servers" data-variant="primary" className="rounded-xl px-3.5 py-2 text-sm font-medium">
            {t("dashboard.manage-vps-keys") === "dashboard.manage-vps-keys" ? "Manage VPS" : t("dashboard.manage-vps-keys")}
          </Link>
          <Link href="/operation-tasks" data-variant="secondary" className="rounded-xl px-3.5 py-2 text-sm">
            {t("nav.operation-tasks") === "nav.operation-tasks" ? "Tasks" : t("nav.operation-tasks")}
          </Link>
        </div>
      </div>
    </header>
  );
}

export function DashboardServerHero({ summary }: { summary: DashboardServerSummary }) {
  const { t } = useI18n();
  const eyebrow = t("dashboard.server-overview");
  const onlineSuffix = t("dashboard.online-vps-suffix");
  const managedPrefix = t("dashboard.managed-nodes-prefix");
  const managedSuffix = t("dashboard.managed-nodes-suffix");
  const sshSuffix = t("dashboard.ssh-bound-suffix");
  const gatewaySuffix = t("dashboard.direct-gateway-online-suffix");
  const cta = t("dashboard.manage-vps-keys");
  const onlineLabel = t("dashboard.online-vps");
  const disabledLabel = t("dashboard.offline-disabled");
  const sshLabel = t("dashboard.ssh-key-bound");
  const gatewayLabel = t("dashboard.direct-gateway");

  return (
    <section data-dashboard-widget="server-status" className="mb-6 overflow-hidden rounded-3xl border border-[var(--border)] bg-[linear-gradient(145deg,color-mix(in_srgb,var(--accent-bg)_55%,var(--surface)),var(--surface))] p-5 shadow-[var(--shadow-sm)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">{eyebrow}</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--text-primary)]">{summary.enabled} {onlineSuffix}</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
            {managedPrefix} {summary.total} {managedSuffix}, {summary.sshKey} {sshSuffix}, {summary.directGateway} {gatewaySuffix}.
          </p>
        </div>
        <Link href="/servers" data-variant="primary" className="rounded-xl px-4 py-2.5 text-sm font-semibold">
          {cta}
        </Link>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={onlineLabel} value={String(summary.enabled)} accent={summary.enabled > 0} accentColor="emerald" />
        <StatCard label={disabledLabel} value={String(summary.disabled)} accent={summary.disabled > 0} accentColor="amber" />
        <StatCard label={sshLabel} value={`${summary.sshKey}/${summary.total}`} accent={summary.sshKey > 0} accentColor="cyan" />
        <StatCard label={gatewayLabel} value={String(summary.directGateway)} accent={summary.directGateway > 0} accentColor="cyan" />
      </div>
    </section>
  );
}

export function DashboardStatsSection({ storage, queue }: { storage: DashboardStorageSummary; queue: DashboardQueueSummary }) {
  const { t } = useI18n();
  const coreTitle = t("dashboard.core-resources");
  const queueTitle = t("dashboard.ops-queue");
  const vpsNodes = t("dashboard.vps-nodes");
  const enabledNodes = t("dashboard.enabled-nodes");
  const storageNodes = t("dashboard.storage-nodes");
  const fileEntries = t("dashboard.file-entries");
  const pending = t("dashboard.pending-approvals");
  const downloads = t("dashboard.download-tasks");
  const running = t("dashboard.running");
  const completed = t("dashboard.completed");
  const failed = t("dashboard.failed");
  const notificationScheduled = t("dashboard.notifications-scheduled");
  const unread = t("dashboard.unread");
  const active = t("dashboard.active");

  const downloadValue = queue.downloads.running > 0 ? `${queue.downloads.running} ${running}` : String(queue.downloads.running + queue.downloads.completed + queue.downloads.failed);
  const downloadDetail = queue.downloads.running > 0 ? `${queue.downloads.running} ${running} / ${queue.downloads.completed} ${completed} / ${queue.downloads.failed} ${failed}` : undefined;

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
      <div data-card className="p-4">
        <h2 className="text-sm font-medium text-[var(--text-primary)]">{coreTitle}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-2">
          <StatCard label={vpsNodes} value={String(storage.serverTotal)} accent={false} />
          <StatCard label={enabledNodes} value={String(storage.serverEnabled)} accent={false} />
          <StatCard label={storageNodes} value={String(storage.totalNodes)} accent={false} />
          <StatCard label={fileEntries} value={String(storage.totalEntries)} accent={false} />
        </div>
      </div>
      <div data-card className="p-4">
        <h2 className="text-sm font-medium text-[var(--text-primary)]">{queueTitle}</h2>
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
  const { t } = useI18n();
  const labels = {
    servers: t("dashboard.quick.servers"),
    serversDesc: t("dashboard.quick.servers-desc"),
    files: t("dashboard.quick.files"),
    filesDesc: t("dashboard.quick.files-desc"),
    downloads: t("dashboard.quick.downloads"),
    downloadsDesc: t("dashboard.quick.downloads-desc"),
    approvals: t("dashboard.quick.approvals"),
    approvalsDesc: t("dashboard.quick.approvals-desc"),
    scheduled: t("dashboard.quick.scheduled"),
    scheduledDesc: t("dashboard.quick.scheduled-desc"),
    notifications: t("dashboard.quick.notifications"),
    notificationsDesc: t("dashboard.quick.notifications-desc"),
    running: t("dashboard.running"),
    pending: t("dashboard.pending-approvals"),
    active: t("dashboard.active"),
    unread: t("dashboard.unread"),
  };

  return (
    <section data-dashboard-widget="quick-links" className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
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
  const { t } = useI18n();
  const approvalsTitle = t("dashboard.recent-approvals");
  const auditTitle = t("dashboard.recent-audit");
  const noRequests = t("dashboard.no-command-requests");
  const noAudit = t("dashboard.no-audit-logs");
  const assistant = t("dashboard.actor-assistant");
  const user = t("dashboard.actor-user");
  const targetPrefix = t("dashboard.target-prefix");
  const targetSuffix = t("dashboard.target-suffix");
  const viewAll = t("dashboard.view-all");

  return (
    <section data-dashboard-widget="audit-log" className="mt-8 grid gap-6 lg:grid-cols-2">
      <div>
        <h2 className="mb-4 text-lg font-semibold text-[var(--text-primary)]">{approvalsTitle}</h2>
        {recentRequests.length === 0 ? (
          <EmptyState text={noRequests} />
        ) : (
          <div className="space-y-2.5">
            {recentRequests.map((request) => (
              <article data-card key={request.id} className="p-4 hover:bg-[var(--surface)]/[0.04]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-medium text-[var(--text-primary)] truncate">{request.title}</h3>
                    <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                      {request.requester.displayName || request.requester.username}
                      {request.isAssistantInitiated ? ` · ${assistant}` : ` · ${user}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Badge color={request.status === "PENDING_APPROVAL" ? "amber" : request.status === "APPROVED" ? "emerald" : "slate"}>{request.approvalStateLabel}</Badge>
                    <Badge color="slate">{targetPrefix} {request.targetCount} {targetSuffix}</Badge>
                  </div>
                </div>
                <p className="mt-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-3 py-1.5 font-mono text-xs text-[var(--color-action)]">{request.command}</p>
              </article>
            ))}
          </div>
        )}
      </div>
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">{auditTitle}</h2>
          <Link href="/audit" className="text-xs text-[var(--color-action)] transition-colors hover:text-[var(--color-action-hover)]">{viewAll}</Link>
        </div>
        {recentAuditLogs.length === 0 ? (
          <EmptyState text={noAudit} />
        ) : (
          <div className="space-y-1.5">
            {recentAuditLogs.map((log) => (
              <div key={log.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3.5 py-2.5 transition-colors duration-150 hover:bg-[var(--surface)]/[0.04]">
                <div className="flex items-center gap-2 text-xs">
                  <Badge color={log.severity === "WARNING" ? "amber" : log.severity === "CRITICAL" ? "rose" : "slate"}>{log.action}</Badge>
                  <span className="min-w-0 flex-1 truncate text-[var(--text-muted)]">{log.actor?.displayName ?? log.actor?.username ?? (log.actorType === "SYSTEM" ? t("dashboard.actor-system") : log.actorType)}</span>
                  <time className="shrink-0 whitespace-nowrap text-[var(--text-muted)]" dateTime={log.createdAt} suppressHydrationWarning>{log.formattedCreatedAt}</time>
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
  const badgeBg = badgeColor === "cyan" ? "border-[var(--color-action-border)] bg-[var(--color-action-bg)] text-[var(--color-action)]" : "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)]";
  return (
 <Link data-card href={href} className="group transition-colors duration-150 hover:border-[var(--color-action-border)] hover:bg-[var(--color-action-bg)]">
      <div className="text-[var(--text-secondary)] transition-colors duration-150 group-hover:text-[var(--color-action)]">{icon}</div>
      <div className="mt-3 text-sm font-medium text-[var(--text-primary)]">{title}</div>
      <p className="mt-1 text-xs text-[var(--text-muted)]">{desc}</p>
      {badge && <span className={`mt-2.5 inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${badgeBg}`}>{badge}</span>}
    </Link>
  );
}

function Badge({ color, children }: { color: "amber" | "emerald" | "rose" | "slate"; children: React.ReactNode }) {
  const styles = {
    amber: "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)]",
    emerald: "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]",
    rose: "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger)]",
    slate: "border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-secondary)]",
  };
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${styles[color]}`}>{children}</span>;
}

function ServerIcon() { return <svg className="w-6 h-6" fill="none" stroke="currentColor" width="24" height="24" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" /></svg>; }
function FilesIcon() { return <svg className="w-6 h-6" fill="none" stroke="currentColor" width="24" height="24" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>; }
function DownloadsIcon() { return <svg className="w-6 h-6" fill="none" stroke="currentColor" width="24" height="24" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>; }
function ApprovalsIcon() { return <svg className="w-6 h-6" fill="none" stroke="currentColor" width="24" height="24" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>; }
function ScheduledIcon() { return <svg className="w-6 h-6" fill="none" stroke="currentColor" width="24" height="24" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>; }
function NotificationsIcon() { return <svg className="w-6 h-6" fill="none" stroke="currentColor" width="24" height="24" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>; }
