type Translator = (key: string, vars?: Record<string, string | number>) => string;

const STATUS_KEYS: Record<string, string> = {
  PENDING: "common.status.pending",
  PENDING_APPROVAL: "common.status.pendingApproval",
  APPROVED: "common.status.approved",
  RUNNING: "common.status.running",
  COMPLETED: "common.status.completed",
  SUCCESS: "common.status.completed",
  SUCCEEDED: "common.status.completed",
  FAILED: "common.status.failed",
  CANCELLING: "common.status.cancelling",
  CANCELLED: "common.status.cancelled",
  REJECTED: "common.status.rejected",
  VOIDED: "common.status.voided",
  PAUSED: "common.status.paused",
  ACTIVE: "common.status.active",
  READY: "common.status.ready",
  HEALTHY: "common.status.healthy",
  WARNING: "common.status.warning",
  CRITICAL: "common.status.critical",
};

export function getDomainStatusLabel(t: Translator, status: string): string {
  const key = STATUS_KEYS[status.trim().toUpperCase()];
  return key ? t(key) : status;
}

export function getBackupTypeLabel(t: Translator, type: string): string {
  const key = {
    DATABASE: "common.databaseBackup",
    FILES: "common.fileBackup",
    FULL: "common.fullBackup",
  }[type.trim().toUpperCase()];
  return key ? t(key) : type;
}

/** How the task centre names a task: a backup by its type (its stored title reads "DATABASE backup"), any other by its title. */
/**
 * Background jobs keep the English title they were created with ("Run playbook nightly", "Alert rule evaluation",
 * "ITSM ticket.created: Disk full"), and that is what the task centre and the dashboard showed in Chinese too. A
 * title in one of those forms is said in the page's language; any other title is shown as stored.
 */
const JOB_TITLES: Array<[RegExp, (t: Translator, match: RegExpMatchArray) => string]> = [
  [/^AI ops daily scan$/, (t) => t("operationTasks.jobTitle.aiOpsScan")],
  [/^Alert rule evaluation$/, (t) => t("operationTasks.jobTitle.alertEvaluation")],
  [/^Background traffic sampling$/, (t) => t("operationTasks.jobTitle.trafficSampling")],
  [/^Sample fleet health$/, (t) => t("operationTasks.jobTitle.healthSampling")],
  [/^Backup schedule dispatch tick$/, (t) => t("operationTasks.jobTitle.backupScheduleTick")],
  [/^Scheduled task dispatch tick$/, (t) => t("operationTasks.jobTitle.scheduledTaskTick")],
  [/^Playbook Cron trigger dispatch tick$/, (t) => t("operationTasks.jobTitle.playbookTriggerTick")],
  [/^Cost daily aggregation snapshot$/, (t) => t("operationTasks.jobTitle.costSnapshot")],
  [/^Operation task cross-source retention policy pruning$/, (t) => t("operationTasks.jobTitle.taskRetention")],
  [/^Ticket SLA escalation sweep$/, (t) => t("operationTasks.jobTitle.ticketSla")],
  [/^Clean up old backups \(automatic retention policy\)$/, (t) => t("operationTasks.jobTitle.backupRetentionPolicy")],
  [/^Backup retention \((\d+)d\)$/, (t, m) => t("operationTasks.jobTitle.backupRetentionDays", { days: Number(m[1]) })],
  // One entry per backup type: "Create database backup" reads as one phrase in both languages.
  [/^Create (DATABASE|FILES|FULL) backup$/i, (t, m) => t(`operationTasks.jobTitle.createBackup.${m[1]!.toUpperCase()}`)],
  [/^Retry (DATABASE|FILES|FULL) backup$/i, (t, m) => t(`operationTasks.jobTitle.retryBackup.${m[1]!.toUpperCase()}`)],
  [/^Drill (DATABASE|FILES|FULL) backup$/i, (t, m) => t(`operationTasks.jobTitle.drillBackup.${m[1]!.toUpperCase()}`)],
  [/^Scheduled backup: (.+)$/, (t, m) => t("operationTasks.jobTitle.scheduledBackup", { name: m[1]! })],
  [/^VPS backup retry: ([\w-]+) \((.+)\)$/, (t, m) => t("operationTasks.jobTitle.vpsBackupRetry", { type: vpsBackupPresetLabel(t, m[1]!), server: m[2]! })],
  [/^VPS backup: ([\w-]+) \((.+)\)$/, (t, m) => t("operationTasks.jobTitle.vpsBackupNow", { type: vpsBackupPresetLabel(t, m[1]!), server: m[2]! })],
  [/^VPS backup: (.+)$/, (t, m) => t("operationTasks.jobTitle.vpsBackupScheduled", { name: m[1]! })],
  [/^SFTP Sync: (.+)$/, (t, m) => t("operationTasks.jobTitle.sftpSync", { name: m[1]! })],
  [/^SFTP stale inventory sweep \(all nodes\)$|^SFTP stale inventory: all nodes$/, (t) => t("operationTasks.jobTitle.sftpStaleAll")],
  [/^SFTP stale inventory: team scope \((\d+)\)$/, (t, m) => t("operationTasks.jobTitle.sftpStaleTeam", { count: Number(m[1]) })],
  [/^SFTP stale inventory: (.+)$/, (t, m) => t("operationTasks.jobTitle.sftpStaleNode", { node: m[1]! })],
  [/^Execute command (.+)$/, (t, m) => t("operationTasks.jobTitle.executeCommand", { id: m[1]! })],
  [/^Run playbook (.+)$/, (t, m) => t("operationTasks.jobTitle.runPlaybook", { name: m[1]! })],
  [/^Relay download (.+)$/, (t, m) => t("operationTasks.jobTitle.relayDownload", { id: m[1]! })],
  [/^Direct download (.+)$/, (t, m) => t("operationTasks.jobTitle.directDownload", { id: m[1]! })],
  [/^ITSM ([a-z_]+(?:\.[a-z_]+)+): (.+)$/, (t, m) => t("operationTasks.jobTitle.itsmOutbound", { event: itsmEventLabel(t, m[1]!), title: m[2]! })],
  [/^VPS backup schedule tick$/, (t) => t("operationTasks.jobTitle.vpsBackupScheduleTick")],
  // File operations: "<action> <count>" (src/app/api/files/operations/route.ts).
  [/^(copy|move|delete) (\d+)$/, (t, m) => t(`operationTasks.jobTitle.files.${m[1]!}`, { count: Number(m[2]) })],
];

/** A background job's type ("backup.create", "playbook.run") in the page's language; an unknown type as written. */
export function getJobTypeLabel(t: Translator, type: string): string {
  const key = `operationTasks.jobType.${type}`;
  const label = t(key);
  return label === key ? type : label;
}

function vpsBackupPresetLabel(t: Translator, preset: string): string {
  const key = `vpsBackup.preset.${preset}`;
  const label = t(key);
  return label === key ? preset : label;
}

function itsmEventLabel(t: Translator, event: string): string {
  const key = `itsmPage.eventType.${event}`;
  const label = t(key);
  return label === key ? event : label;
}

/** A background job's stored title in the page's language, when it is one of the titles the platform writes. */
export function getJobTitleLabel(t: Translator, title: string): string {
  for (const [pattern, render] of JOB_TITLES) {
    const match = title.match(pattern);
    if (match) return render(t, match);
  }
  return title;
}

export function getOperationTaskTitle(t: Translator, task: { source: string; taskType?: string | null; title: string }): string {
  if (task.source === "backup") {
    // A backup row is named by its type; the stored title is "<TYPE> backup".
    const type = task.taskType ?? task.title.match(/^(\w+) backup$/)?.[1];
    return type ? getBackupTypeLabel(t, type) : task.title;
  }
  return task.source === "job" ? getJobTitleLabel(t, task.title) : task.title;
}

export function getStorageDriverLabel(t: Translator, driver: string): string {
  const key = {
    LOCAL: "common.storageDriver.local",
    SFTP: "common.storageDriver.sftp",
    WEBDAV: "common.storageDriver.webdav",
  }[driver.trim().toUpperCase()];
  return key ? t(key) : driver;
}

/** How a file of this driver reaches the browser, in the viewer's language. */
export function getStorageAccessLabel(t: Translator, driver: string, mode: string): string {
  const key = driver === "LOCAL"
    ? "common.storageAccess.local"
    : driver === "WEBDAV"
      ? "common.storageAccess.webdav"
      : mode === "direct-url"
        ? "common.storageAccess.sftpDirect"
        : "common.storageAccess.sftpProxy";
  return t(key);
}

/** Where a storage node keeps its files, in the viewer's language. */
export function getStorageConnectionLabel(t: Translator, node: { driver: string; basePath: string; host?: string | null; port?: number | null; username?: string | null }): string {
  if (node.driver === "LOCAL") return t("common.storageConnection.local", { path: node.basePath });
  if (node.driver === "WEBDAV") return t("common.storageConnection.webdav", { path: node.basePath });
  const remote = node.host ? `${node.username ?? "root"}@${node.host}:${node.port ?? 22}` : t("common.storageConnection.boundServer");
  return t("common.storageConnection.sftp", { remote, path: node.basePath });
}
