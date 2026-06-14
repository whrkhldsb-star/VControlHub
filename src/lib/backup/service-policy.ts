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
	path: "路径无效或越界",
	permission: "权限或只读路径",
	timeout: "执行超时",
	script: "备份脚本执行失败",
	missing: "文件或目录不存在",
	storage: "存储空间或写入失败",
	unknown: "未归类失败",
};

const backupFailureRemediation: Record<BackupFailureCategory, string> = {
	path: "检查备份记录的 portable path，避免绝对路径、..、反斜杠或跨目录片段；必要时作废旧记录后重新创建备份。",
	permission: "优先确认 BACKUP_DIR 或 /var/backups/<slug> 是可写目录，并把旧的仓库内只读路径失败记录标记作废或重试到新的系统备份根。",
	timeout: "检查备份体积、网络/磁盘 IO 与 30 分钟执行窗口；必要时拆分文件备份或改为后台低峰执行。",
	script: "查看对应 Durable Job 日志和 deploy/backup.sh 输出，先修复脚本依赖、环境变量或数据库连接后再重试。",
	missing: "确认备份脚本引用的源目录、restore 目标或历史 artifact 仍存在；对已不存在的旧 artifact 保留审计并标记作废。",
	storage: "检查磁盘空间、inode、挂载只读状态和备份目录写入权限；释放空间或切换 BACKUP_DIR 后再重试。",
	unknown: "保留错误片段并到任务中心查看完整日志；若能稳定复现，再按路径/权限/脚本/存储方向细分处理。",
};

function classifyBackupFailure(message: string | null | undefined): BackupFailureCategory {
	const value = (message || "").toLowerCase();
	if (/permission|denied|readonly|read-only|只读|权限|eacces|eperm/.test(value)) return "permission";
	if (/路径|path|portable|traversal|invalid/.test(value)) return "path";
	if (/timeout|timed out|超时/.test(value)) return "timeout";
	if (/no such file|enoent|not found|不存在|missing/.test(value)) return "missing";
	if (/no space|enospc|disk|write|写入|空间/.test(value)) return "storage";
	if (/exit code|command failed|backup\.sh|restore-db\.sh|脚本|执行失败/.test(value)) return "script";
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
	if (size <= 0) return "待生成";
	if (size < 1024) return `${size} B`;
	if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
	if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
	return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
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
