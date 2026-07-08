/**
 * Backup service — policy / failure-summary aggregation
 * (R28 god-file split).
 *
 * Pure functions over an in-memory record list. No prisma, no I/O.
 * Consumes `BackupRecordForSummary` and produces a `BackupPolicySummary`
 * (or a `BackupFailureSummaryItem[]`) without touching the DB.
 */
import type {
	BackupFailureSummaryItem,
	BackupPolicySummary,
	BackupRecordForSummary,
} from "./service-types";
import { isBackupType } from "./service-types";

type BackupFailureCategory =
	| "path"
	| "permission"
	| "timeout"
	| "script"
	| "missing"
	| "storage"
	| "unknown";

function parseBackupSizeBytes(value: string | number | bigint | null | undefined) {
	if (value == null) return 0;
	const numeric = typeof value === "bigint" ? Number(value) : typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(numeric) || numeric < 0) return 0;
	return numeric;
}

const backupFailureCategoryLabels: Record<BackupFailureCategory, string> = {
	path: "Invalid or out-of-bounds path",
	permission: "Permission or read-only path",
	timeout: "Execution timeout",
	script: "Backup script execution failed",
	missing: "File or directory not found",
	storage: "Storage space or write failure",
	unknown: "Uncategorized failure",
};

const backupFailureRemediation: Record<BackupFailureCategory, string> = {
	path: "Check the backup record's portable path; avoid absolute paths, .., backslashes, or cross-directory segments. Void old records and recreate the backup if needed.",
	permission: "Verify that BACKUP_DIR or /var/backups/<slug> is a writable directory. Mark old read-only path failures as voided or retry with a new system backup root.",
	timeout: "Check backup size, network/disk IO, and the 30-minute execution window. Split file backups or schedule them during off-peak hours if needed.",
	script: "Review the corresponding Durable Job logs and deploy/backup.sh output. Fix script dependencies, environment variables, or database connections before retrying.",
	missing: "Confirm that source directories, restore targets, and historical artifacts referenced by the backup script still exist. Preserve audit trails for missing artifacts and mark them as voided.",
	storage: "Check disk space, inodes, mount read-only status, and backup directory write permissions. Free up space or switch BACKUP_DIR before retrying.",
	unknown: "Preserve the error snippet and check the full logs in the task center. If reproducible, categorize by path/permission/script/storage direction.",
};

function classifyBackupFailure(message: string | null | undefined): BackupFailureCategory {
	const value = (message || "").toLowerCase();
	if (/permission|denied|readonly|read-only|只读|权限|eacces|eperm/.test(value)) return "permission";
	if (/路径|path|portable|traversal|invalid/.test(value)) return "path";
	if (/timeout|timed out|超时/.test(value)) return "timeout";
	if (/no such file|enoent|not found|不存在|missing/.test(value)) return "missing";
	if (/no space|enospc|disk|write|写入|空间/.test(value)) return "storage";
	if (/exit code|command failed|backup\.sh|restore-db\.sh|脚本|Execution failed/.test(value)) return "script";
	return "unknown";
}

function summarizeBackupFailures(records: BackupRecordForSummary[]): BackupFailureSummaryItem[] {
	const grouped = new Map<BackupFailureCategory, BackupFailureSummaryItem & { latestAt: Date }>();
	for (const record of records) {
		if (record.status !== "FAILED") continue;
		const category = classifyBackupFailure(record.errorMessage);
		const latestAt = record.completedAt ?? record.createdAt;
		const existing = grouped.get(category);
		if (!existing) {
			grouped.set(category, {
				category,
				label: backupFailureCategoryLabels[category],
				remediation: backupFailureRemediation[category],
				count: 1,
				latestMessage: record.errorMessage || record.note || null,
				latestRecordPath: record.filePath ?? null,
				latestAt,
			});
			continue;
		}
		existing.count += 1;
		if (latestAt >= existing.latestAt) {
			existing.latestAt = latestAt;
			existing.latestMessage = record.errorMessage || record.note || null;
			existing.latestRecordPath = record.filePath ?? null;
		}
	}

	return Array.from(grouped.values())
		.sort((a, b) => b.count - a.count || b.latestAt.getTime() - a.latestAt.getTime())
		.map(({ latestAt: _latestAt, ...item }) => item);
}

export function formatBackupSize(value: string | number | bigint | null | undefined) {
	const size = parseBackupSizeBytes(value);
	if (size <= 0) return "Pending";
	if (size < 1024) return `${size} B`;
	if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
	if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
	return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export type BackupRetentionCandidate = {
	id: string;
	type: string;
	filePath: string | null;
	completedAt: Date;
	reason: "older-than-cutoff" | "exceeds-keep-latest";
};

export type BackupRetentionPlan = {
	candidates: BackupRetentionCandidate[];
	olderThanDays: number;
	keepLatestPerType: number;
	cutoff: Date;
	oldestKeptByType: Record<string, Date | null>;
};

/**
 * Pure retention planner — given a list of backup records (already shaped
 * for the policy summary), decide which `COMPLETED` records are eligible
 * for automatic cleanup.
 *
 * Rule:
 *   1. Sort each type's `COMPLETED` records by `completedAt` DESC.
 *   2. Always keep the first `keepLatestPerType` per type.
 *   3. Any older record whose `completedAt` is also older than the
 *      `olderThanDays` cutoff is a candidate.
 *   4. Records with `keepLatestPerType = 0` (i.e. "keep nothing") are
 *      still gated by the cutoff — cutoff is a safety floor so a single
 *      run can never delete brand-new backups.
 *
 * Default values match the existing 30-day hint surfaced on the
 * `/backups` page (`recordsOlderThan30Days`) plus a 3-per-type keep.
 */
export function pruneOldBackupRecords(
	records: BackupRecordForSummary[],
	options: { olderThanDays?: number; keepLatestPerType?: number; now?: Date } = {},
): BackupRetentionPlan {
	const olderThanDays = options.olderThanDays ?? 30;
	const keepLatestPerType = options.keepLatestPerType ?? 3;
	const now = options.now ?? new Date();
	const cutoff = new Date(now.getTime() - olderThanDays * 24 * 60 * 60 * 1000);

	const candidates: BackupRetentionCandidate[] = [];
	const oldestKeptByType: Record<string, Date | null> = {};

	const byType = new Map<string, BackupRecordForSummary[]>();
	for (const record of records) {
		if (record.status !== "COMPLETED") continue;
		if (!isBackupType(record.type)) continue;
		const list = byType.get(record.type) ?? [];
		list.push(record);
		byType.set(record.type, list);
	}

	for (const [type, list] of byType) {
		const sorted = [...list].sort((a, b) => {
			const aAt = a.completedAt ?? a.createdAt;
			const bAt = b.completedAt ?? b.createdAt;
			return bAt.getTime() - aAt.getTime();
		});
		const keepSet = new Set(sorted.slice(0, keepLatestPerType));
		const oldestKept = sorted[keepLatestPerType - 1];
		oldestKeptByType[type] = oldestKept ? (oldestKept.completedAt ?? oldestKept.createdAt) ?? null : null;
		for (const record of sorted.slice(keepLatestPerType)) {
			const completedAt = record.completedAt ?? record.createdAt;
			if (completedAt >= cutoff) continue;
			candidates.push({
				id: record.id,
				type: record.type,
				filePath: record.filePath ?? null,
				completedAt,
				reason: "exceeds-keep-latest",
			});
		}
		// Records within keep window but past cutoff — eligible to delete
		// because the user explicitly chose keepLatestPerType (treats the
		// cutoff as a hard floor for the keep window).
		for (const record of keepSet) {
			const completedAt = record.completedAt ?? record.createdAt;
			if (completedAt < cutoff) {
				candidates.push({
					id: record.id,
					type: record.type,
					filePath: record.filePath ?? null,
					completedAt,
					reason: "older-than-cutoff",
				});
			}
		}
	}

	// Stable sort: oldest first (FIFO cleanup) then by id for determinism.
	candidates.sort((a, b) => a.completedAt.getTime() - b.completedAt.getTime() || a.id.localeCompare(b.id));

	return { candidates, olderThanDays, keepLatestPerType, cutoff, oldestKeptByType };
}

export function summarizeBackupPolicy(records: BackupRecordForSummary[], now = new Date()): BackupPolicySummary {
	const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
	const byType: BackupPolicySummary["byType"] = {
		DATABASE: { count: 0, sizeBytes: 0 },
		FILES: { count: 0, sizeBytes: 0 },
		FULL: { count: 0, sizeBytes: 0 },
	};
	let completedRecords = 0;
	let failedRecords = 0;
	let runningRecords = 0;
	let totalCompletedSizeBytes = 0;
	let latestCompletedAt: Date | null = null;
	let oldestCompletedAt: Date | null = null;
	let recordsOlderThan30Days = 0;
	let largestCompleted: BackupPolicySummary["largestCompleted"] = null;

	for (const record of records) {
		if (record.status === "FAILED") failedRecords += 1;
		if (record.status === "RUNNING" || record.status === "PENDING") runningRecords += 1;
		if (record.status !== "COMPLETED") continue;

		completedRecords += 1;
		const sizeBytes = parseBackupSizeBytes(record.fileSize);
		totalCompletedSizeBytes += sizeBytes;
		if (isBackupType(record.type)) {
			byType[record.type].count += 1;
			byType[record.type].sizeBytes += sizeBytes;
		}
		if (!largestCompleted || sizeBytes > largestCompleted.sizeBytes) {
			largestCompleted = { type: record.type, filePath: record.filePath ?? null, sizeBytes };
		}

		const completedAt = record.completedAt ?? record.createdAt;
		if (!latestCompletedAt || completedAt > latestCompletedAt) latestCompletedAt = completedAt;
		if (!oldestCompletedAt || completedAt < oldestCompletedAt) oldestCompletedAt = completedAt;
		if (completedAt < cutoff) recordsOlderThan30Days += 1;
	}

	return {
		totalRecords: records.length,
		completedRecords,
		failedRecords,
		runningRecords,
		totalCompletedSizeBytes,
		latestCompletedAt,
		oldestCompletedAt,
		recordsOlderThan30Days,
		byType,
		failureSummary: summarizeBackupFailures(records),
		largestCompleted,
	};
}
