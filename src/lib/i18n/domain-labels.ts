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
  }[driver.trim().toUpperCase()];
  return key ? t(key) : driver;
}
