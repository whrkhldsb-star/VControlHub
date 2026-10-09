"use client";

import Link from "next/link";

import { PageHeader, EmptyState, ListPanel, ListRow, MetricPanel } from "@/components/page-shell";
import {
  IconBadgeCheck,
  IconBell,
  IconCalendarClock,
  IconChevronRight,
  IconDownload,
  IconFolder,
  IconServer,
} from "@/components/nav-icons";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { useI18n } from "@/lib/i18n/use-locale";
import { getDomainStatusLabel } from "@/lib/i18n/domain-labels";
import { ButtonLink } from "@/components/action-button";

const AUDIT_ACTOR_LABEL_KEYS: Record<string, string> = {
  USER: "dashboard.actor-user",
  SYSTEM: "dashboard.actor-system",
  ASSISTANT: "dashboard.actor-assistant",
};

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
    <PageHeader eyebrow={t("nav.dashboard")} title={title} description={`${currentUser}: ${username}`}>
          <ButtonLink variant="primary" href="/servers" iconRight={<IconChevronRight aria-hidden />}>
            {t("nav.servers")}
          </ButtonLink>
          <ButtonLink variant="secondary" href="/operation-tasks">
            {t("nav.operation-tasks")}
          </ButtonLink>
    </PageHeader>
  );
}

export function DashboardServerHero({ summary }: { summary: DashboardServerSummary }) {
  const { t } = useI18n();
  const eyebrow = t("dashboard.server-overview");
  const onlineSuffix = t("dashboard.enabled-nodes");
  const managedPrefix = t("dashboard.managed-nodes-prefix");
  const managedSuffix = t("dashboard.managed-nodes-suffix");
  const sshSuffix = t("dashboard.ssh-bound-suffix");
  const gatewaySuffix = t("dashboard.direct-gateway");
  const onlineLabel = t("dashboard.enabled-nodes");
  const disabledLabel = t("dashboard.disabled-nodes");
  const sshLabel = t("dashboard.ssh-key-bound");
  const gatewayLabel = t("dashboard.direct-gateway");

  return (
    <MetricPanel
      data-dashboard-widget="server-status"
      eyebrow={eyebrow}
      title={`${summary.enabled} ${onlineSuffix}`}
      description={`${managedPrefix} ${summary.total} ${managedSuffix}, ${summary.sshKey} ${sshSuffix}, ${summary.directGateway} ${gatewaySuffix}.`}
      metrics={[
        { label: onlineLabel, value: String(summary.enabled), tone: summary.enabled > 0 ? "emerald" : undefined },
        { label: disabledLabel, value: String(summary.disabled), tone: summary.disabled > 0 ? "amber" : undefined },
        { label: sshLabel, value: `${summary.sshKey}/${summary.total}` },
        { label: gatewayLabel, value: String(summary.directGateway) },
      ]}
    />
  );
}

export function DashboardStatsSection({ storage, queue }: { storage: DashboardStorageSummary; queue: DashboardQueueSummary }) {
  const { t } = useI18n();
  const coreTitle = t("dashboard.core-resources");
  const queueTitle = t("dashboard.ops-queue");
  const vpsNodes = t("dashboard.vps-nodes");
  const storageNodes = t("dashboard.storage-nodes");
  const fileEntries = t("dashboard.file-entries");
  const pending = t("dashboard.pending-approvals");
  const downloads = t("dashboard.download-tasks");
  const running = t("dashboard.running");
  const completed = t("dashboard.completed");
  const failed = t("dashboard.failed");

  const downloadValue = queue.downloads.running > 0 ? `${queue.downloads.running} ${running}` : String(queue.downloads.running + queue.downloads.completed + queue.downloads.failed);
  const downloadDetail = queue.downloads.running > 0 ? `${queue.downloads.running} ${running} / ${queue.downloads.completed} ${completed} / ${queue.downloads.failed} ${failed}` : undefined;

  return (
    <section className="mb-6 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <MetricPanel
        title={coreTitle}
        columns={3}
        metrics={[
          { label: vpsNodes, value: String(storage.serverTotal), detail: t("dashboard.enabled-count", { count: storage.serverEnabled }), href: "/servers" },
          { label: storageNodes, value: String(storage.totalNodes), href: "/files" },
          { label: fileEntries, value: String(storage.totalEntries), href: "/files" },
        ]}
      />
      <MetricPanel
        title={queueTitle}
        columns={4}
        metrics={[
          { label: pending, value: String(queue.pendingApprovals), tone: queue.pendingApprovals > 0 ? "amber" : undefined, href: "/requests" },
          { label: downloads, value: downloadValue, tone: queue.downloads.running > 0 ? "cyan" : undefined, detail: downloadDetail, href: "/downloads" },
          { label: t("dashboard.unread-notifications"), value: String(queue.unreadNotifications), tone: queue.unreadNotifications > 0 ? "amber" : undefined, href: "/notifications" },
          { label: t("dashboard.active-schedules"), value: String(queue.activeScheduledTasks), href: "/scheduled-tasks" },
        ]}
      />
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
    <section data-dashboard-widget="quick-links" className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <QuickLink href="/servers" title={labels.servers} desc={labels.serversDesc} icon={<IconServer />} />
      <QuickLink href="/files" title={labels.files} desc={labels.filesDesc} icon={<IconFolder />} />
      <QuickLink href="/downloads" title={labels.downloads} desc={labels.downloadsDesc} icon={<IconDownload />} badge={downloads.running > 0 ? `${downloads.running} ${labels.running}` : undefined} badgeColor="cyan" />
      <QuickLink href="/requests" title={labels.approvals} desc={labels.approvalsDesc} icon={<IconBadgeCheck />} badge={pendingApprovals > 0 ? `${pendingApprovals} ${labels.pending}` : undefined} badgeColor="amber" />
      <QuickLink href="/scheduled-tasks" title={labels.scheduled} desc={labels.scheduledDesc} icon={<IconCalendarClock />} badge={activeScheduledTasks > 0 ? `${activeScheduledTasks} ${labels.active}` : undefined} badgeColor="cyan" />
      <QuickLink href="/notifications" title={labels.notifications} desc={labels.notificationsDesc} icon={<IconBell />} badge={unreadNotifications > 0 ? `${unreadNotifications} ${labels.unread}` : undefined} badgeColor="amber" />
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
    <section data-dashboard-widget="audit-log" className="mt-6 grid gap-4 lg:grid-cols-2">
      <ListPanel
        title={approvalsTitle}
        count={recentRequests.length}
        empty={recentRequests.length === 0 ? <EmptyState text={noRequests} /> : undefined}
      >
        {recentRequests.map((request) => (
          <article key={request.id} className="px-4 py-3 transition-colors hover:bg-[var(--surface-hover)] sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="ui-title-group truncate">{request.title}</h3>
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                  {request.requester.displayName || request.requester.username}
                  {request.isAssistantInitiated ? ` · ${assistant}` : ` · ${user}`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Badge color={request.status === "PENDING_APPROVAL" ? "amber" : request.status === "APPROVED" || request.status === "COMPLETED" ? "emerald" : request.status === "FAILED" || request.status === "REJECTED" ? "rose" : "slate"}>
                  {request.approvalStateLabel === request.status ? getDomainStatusLabel(t, request.status) : request.approvalStateLabel}
                </Badge>
                <Badge color="slate">{targetPrefix} {request.targetCount} {targetSuffix}</Badge>
              </div>
            </div>
            <p className="mt-2 truncate rounded-md bg-[var(--surface-subtle)] px-2.5 py-1.5 font-mono text-xs text-[var(--text-secondary)]">{request.command}</p>
          </article>
        ))}
      </ListPanel>
      <ListPanel
        title={auditTitle}
        count={recentAuditLogs.length}
        actions={<Link href="/audit" className="inline-flex items-center gap-0.5 text-[13px] font-medium text-[var(--accent)] transition hover:text-[var(--accent-hover)]">{viewAll}<IconChevronRight size={14} /></Link>}
        empty={recentAuditLogs.length === 0 ? <EmptyState text={noAudit} /> : undefined}
      >
        {recentAuditLogs.map((log) => (
          <ListRow key={log.id}>
            <div className="flex items-center gap-2 text-xs">
              <Badge color={log.severity === "WARNING" ? "amber" : log.severity === "CRITICAL" ? "rose" : "slate"}>{log.action}</Badge>
              <span className="min-w-0 flex-1 truncate text-[var(--text-muted)]">{log.actor?.displayName ?? log.actor?.username ?? t(AUDIT_ACTOR_LABEL_KEYS[log.actorType] ?? "dashboard.actor-user")}</span>
              <time className="shrink-0 whitespace-nowrap text-[var(--text-muted)]" dateTime={log.createdAt} suppressHydrationWarning>{log.formattedCreatedAt}</time>
            </div>
          </ListRow>
        ))}
      </ListPanel>
    </section>
  );
}

function QuickLink({ href, title, desc, icon, badge, badgeColor }: { href: string; title: string; desc: string; icon: React.ReactNode; badge?: string; badgeColor?: "cyan" | "amber" }) {
  return (
    <Link
      data-card
      href={href}
      className="group flex items-start gap-3 !p-4 transition duration-150 hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)] [&>svg]:h-[18px] [&>svg]:w-[18px]">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[var(--text-primary)]">{title}</span>
          {badge ? <StatusBadge tone={badgeColor === "cyan" ? "accent" : "warning"}>{badge}</StatusBadge> : null}
        </span>
        <span className="mt-0.5 block text-[13px] leading-5 text-[var(--text-muted)]">{desc}</span>
      </span>
      <IconChevronRight size={16} className="mt-0.5 shrink-0 text-[var(--text-disabled)] transition group-hover:translate-x-0.5 group-hover:text-[var(--text-muted)]" />
    </Link>
  );
}

function Badge({ color, children }: { color: "amber" | "emerald" | "rose" | "slate"; children: React.ReactNode }) {
  const tone: StatusTone =
    color === "amber" ? "warning" : color === "emerald" ? "success" : color === "rose" ? "danger" : "neutral";
  return <StatusBadge tone={tone}>{children}</StatusBadge>;
}

