/**
 * Backup service — types, constants, and pure path/type helpers
 * (R28 god-file split).
 *
 * No I/O, no prisma, no env reads. Imports nothing but `node:path`
 * for the portable-path assertion.
 */
import { join, normalize, sep } from "node:path";

export const RESTORE_CONFIRM_TEXT = "RESTORE";

export type BackupType = "DATABASE" | "FILES" | "FULL";

type BackupStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

export type BackupRecordForSummary = {
	type: string;
	status: string;
	filePath?: string | null;
	fileSize?: string | number | bigint | null;
	errorMessage?: string | null;
	note?: string | null;
	createdAt: Date;
	completedAt?: Date | null;
};

type BackupFailureCategory =
	| "path"
	| "permission"
	| "timeout"
	| "script"
	| "missing"
	| "storage"
	| "unknown";

export type BackupFailureSummaryItem = {
	category: BackupFailureCategory;
	label: string;
	remediation: string;
	count: number;
	latestMessage: string | null;
	latestRecordPath: string | null;
};

export type BackupPolicySummary = {
	totalRecords: number;
	completedRecords: number;
	failedRecords: number;
	runningRecords: number;
	totalCompletedSizeBytes: number;
	latestCompletedAt: Date | null;
	oldestCompletedAt: Date | null;
	recordsOlderThan30Days: number;
	byType: Record<BackupType, { count: number; sizeBytes: number }>;
	failureSummary: BackupFailureSummaryItem[];
	largestCompleted: { type: string; filePath?: string | null; sizeBytes: number } | null;
};

export function isBackupType(value: string): value is BackupType {
	return value === "DATABASE" || value === "FILES" || value === "FULL";
}

export function buildBackupFilePath(type: BackupType, now = new Date()) {
	const stamp = now.toISOString().replace(/[:.]/g, "-");
	const extension = type === "DATABASE" ? "sql.gz" : "tar.gz";
	return `backups/${type.toLowerCase()}-${stamp}.${extension}`;
}

export function getBackupStorageRoot(projectRoot: string) {
	const configured = process.env.BACKUP_DIR?.trim();
	if (configured) return configured;
	const slug = process.env.APP_SLUG?.trim();
	if (slug) return `/var/backups/${slug}`;
	return join(projectRoot, "backups");
}

export function assertPortableBackupPath(filePath: string) {
	const value = filePath.trim();
	const parts = value.split(/[\\/]+/);
	if (
		!value ||
		value === "." ||
		value.startsWith("/") ||
		value.includes("\0") ||
		value.includes("\\") ||
		value.includes("//") ||
		parts.some((part) => !part || part === "." || part === "..")
	) {
		throw new Error("备份路径必须是可移植的相对路径");
	}
	const normalized = normalize(value);
	if (normalized.startsWith("..") || normalized.includes(`${sep}..${sep}`) || normalized === "..") {
		throw new Error("备份路径必须是可移植的相对路径");
	}
	return value;
}

export function resolveBackupPath(projectRoot: string, filePath: string) {
	const portablePath = assertPortableBackupPath(filePath);
	return join(getBackupStorageRoot(projectRoot), portablePath);
}

/** Internal — exposed for sibling `service-runtime` to type status updates. */
export type { BackupStatus };
