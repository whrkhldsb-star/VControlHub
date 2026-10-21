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
