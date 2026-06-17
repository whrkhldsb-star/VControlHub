/**
 * i18n dictionary: `backupsPage.*` (38 keys).
 *
 * Used by `src/app/backups/page.tsx` (server component):
 *   - PageHeader eyebrow / title / description
 *   - permission-denied notice
 *   - 4 summary cards (completed count / used space / retention / exceptions)
 *   - backup policy overview section
 *   - failure summary section (count / empty / item count / latest record / remediation)
 *   - retention / create / schedule sections
 *   - backup records list (type·status / path·time / size / completedAt / error / restore hint / void hint)
 *
 * Mirrors the `healthPage` server-component pattern: page.tsx imports
 * `t` from `@/lib/i18n/translations` and calls `t("backupsPage.title")`,
 * with the default `zh` locale (the I18nProvider on the client handles
 * the live `zh` ↔ `en` switch via localStorage).
 *
 * Template strings use `{name}` placeholders and should be consumed with
 * `t("...").replace("{name}", value)` for parametric values.
 */
export const zh: Record<string, string> = {
	"backupsPage.eyebrow": "Portable",
	"backupsPage.title": "备份与迁移",
	"backupsPage.description": "记录数据库/文件/完整备份，配合 deploy/backup.sh 与 restore-db.sh 支持迁移到其他系统。恢复命令只展示，不会绕过审批直接执行。",
	"backupsPage.noPermission": "你没有备份管理查看权限。",

	"backupsPage.summary.completed": "完成备份",
	"backupsPage.summary.totalRecords": "共 {count} 条记录",
	"backupsPage.summary.usedSpace": "已用备份空间",
	"backupsPage.summary.largestRecord": "最大：{type} · {size}",
	"backupsPage.summary.largestNone": "暂无",
	"backupsPage.summary.retentionNote": "保留策略提示",
	"backupsPage.summary.retentionHint": "条完成备份超过 30 天，建议复核清理",
	"backupsPage.summary.exceptions": "异常/执行中",
	"backupsPage.summary.exceptionsHint": "失败 / PENDING+RUNNING",

	"backupsPage.overview.title": "备份策略概览",
	"backupsPage.overview.description": "按备份类型汇总数量和容量，辅助规划定时备份、异地备份与保留策略。",
	"backupsPage.overview.latestCompleted": "最近完成：{date}",
	"backupsPage.overview.latestNone": "暂无",
	"backupsPage.overview.typeSummary": "{count} 个 · {size}",

	"backupsPage.failures.title": "备份失败原因聚合",
	"backupsPage.failures.description": "按最近 200 条备份记录中的 FAILED 错误文本归类，优先定位路径、权限、超时、存储空间或脚本执行问题。",
	"backupsPage.failures.count": "失败记录：{count}",
	"backupsPage.failures.empty": "暂无失败备份记录。",
	"backupsPage.failures.itemCount": "{count} 条",
	"backupsPage.failures.latestRecord": "最新记录：{path}",
	"backupsPage.failures.remediation": "建议：{remediation}",

	"backupsPage.retention.title": "保留策略自动清理",
	"backupsPage.retention.description": "按保留天数和每类型保留最新 N 个参数，清理过期的 COMPLETED 备份记录和文件。可在任务中心追踪 <code>backup.retention</code> 任务的完成情况。",

	"backupsPage.create.title": "创建并执行备份",
	"backupsPage.create.description": "提交后会创建可审计备份记录并排入 Durable Job 后台队列；页面可刷新查看 PENDING/RUNNING/COMPLETED 或 FAILED 状态。",

	"backupsPage.schedule.title": "创建定时备份",
	"backupsPage.schedule.description": "选择备份类型、Cron 与执行节点后，会创建一条可审计的定时任务；后续执行日志可在“定时任务”页面追踪。",

	"backupsPage.records.title": "备份记录",
	"backupsPage.records.count": "{count} 条",
	"backupsPage.records.empty": "暂无备份记录",
	"backupsPage.records.typeStatus": "{type} · {status}",
	"backupsPage.records.pathTime": "{path} · {time}",
	"backupsPage.records.creatorSystem": "system",
	"backupsPage.records.size": "大小：{size}",
	"backupsPage.records.completedAt": "完成：{time}",
	"backupsPage.records.notCompleted": "未完成",
	"backupsPage.records.error": "错误：{message}",
	"backupsPage.records.restoreHint": "只有 COMPLETED 状态的备份可以执行恢复。",
	"backupsPage.records.voidHint": "对历史 PENDING/FAILED 记录写入作废说明，不删除备份审计记录。",

	// TR-007 M03: 异地备份 (S3-compatible) 概览 section
	"backupsPage.offsite.title": "异地备份 (S3-compatible)",
	"backupsPage.offsite.description": "每日将本地备份推送至 S3-compatible 端点；配置和 dry-run 在「设置」页的「异地备份」分组。",
	"backupsPage.offsite.status.enabled": "已启用",
	"backupsPage.offsite.status.disabled": "未启用",
	"backupsPage.offsite.provider": "Provider：{provider}",
	"backupsPage.offsite.bucket": "Bucket：{bucket}",
	"backupsPage.offsite.region": "Region：{region}",
	"backupsPage.offsite.window": "每日推送窗口：{hour}:00 (UTC)",
	"backupsPage.offsite.retention": "保留天数：{days} 天",
	"backupsPage.offsite.dryRunLast": "最近一次 dry-run：{status} · 耗时 {latencyMs}ms",
	"backupsPage.offsite.dryRunNever": "尚未执行 dry-run",
	"backupsPage.offsite.dryRunButton": "立即 dry-run",
	"backupsPage.offsite.dryRunning": "正在执行…",
	"backupsPage.offsite.dryRunOk": "dry-run 成功，latency {latencyMs}ms",
	"backupsPage.offsite.dryRunFailed": "dry-run 失败：{message}",
	"backupsPage.offsite.dryRunDisabled": "未启用异地备份",
	"backupsPage.offsite.openSettings": "前往设置",
};

export const en: Record<string, string> = {
	"backupsPage.eyebrow": "Portable",
	"backupsPage.title": "Backups & migration",
	"backupsPage.description": "Records database, file, and full backups, combined with deploy/backup.sh and restore-db.sh to support migration to other systems. Restore commands are shown only and will not bypass approval.",
	"backupsPage.noPermission": "You do not have backup management view permission.",

	"backupsPage.summary.completed": "Completed backups",
	"backupsPage.summary.totalRecords": "{count} records total",
	"backupsPage.summary.usedSpace": "Backup storage used",
	"backupsPage.summary.largestRecord": "Largest: {type} · {size}",
	"backupsPage.summary.largestNone": "None yet",
	"backupsPage.summary.retentionNote": "Retention reminder",
	"backupsPage.summary.retentionHint": " completed backups older than 30 days — review and clean up",
	"backupsPage.summary.exceptions": "Exceptions / running",
	"backupsPage.summary.exceptionsHint": "Failed / PENDING+RUNNING",

	"backupsPage.overview.title": "Backup policy overview",
	"backupsPage.overview.description": "Summarize counts and capacity per backup type, helping schedule offsite backups and retention policy.",
	"backupsPage.overview.latestCompleted": "Latest completed: {date}",
	"backupsPage.overview.latestNone": "None yet",
	"backupsPage.overview.typeSummary": "{count} entries · {size}",

	"backupsPage.failures.title": "Backup failure reasons",
	"backupsPage.failures.description": "Categorize FAILED error text from the most recent 200 backup records, prioritizing path, permission, timeout, storage space, or script execution issues.",
	"backupsPage.failures.count": "Failed records: {count}",
	"backupsPage.failures.empty": "No failed backup records yet.",
	"backupsPage.failures.itemCount": "{count} entries",
	"backupsPage.failures.latestRecord": "Latest record: {path}",
	"backupsPage.failures.remediation": "Suggestion: {remediation}",

	"backupsPage.retention.title": "Automatic retention cleanup",
	"backupsPage.retention.description": "Cleans up expired COMPLETED backup records and files by retention days and per-type keep-latest N parameters. Track the <code>backup.retention</code> job in the operation-tasks center.",

	"backupsPage.create.title": "Create and execute backup",
	"backupsPage.create.description": "Submitting creates an auditable backup record and queues it into the Durable Job background queue. Refresh the page to track PENDING/RUNNING/COMPLETED/FAILED status.",

	"backupsPage.schedule.title": "Create scheduled backup",
	"backupsPage.schedule.description": "Choose a backup type, cron expression, and execution node to create an auditable scheduled task. Execution logs can be tracked on the Scheduled Tasks page.",

	"backupsPage.records.title": "Backup records",
	"backupsPage.records.count": "{count} entries",
	"backupsPage.records.empty": "No backup records yet",
	"backupsPage.records.typeStatus": "{type} · {status}",
	"backupsPage.records.pathTime": "{path} · {time}",
	"backupsPage.records.creatorSystem": "system",
	"backupsPage.records.size": "Size: {size}",
	"backupsPage.records.completedAt": "Completed: {time}",
	"backupsPage.records.notCompleted": "Not completed",
	"backupsPage.records.error": "Error: {message}",
	"backupsPage.records.restoreHint": "Only COMPLETED backups can be restored.",
	"backupsPage.records.voidHint": "Historical PENDING/FAILED records are marked void but not deleted; the audit record is preserved.",

	// TR-007 M03: 异地备份 (S3-compatible) overview section
	"backupsPage.offsite.title": "Offsite backup (S3-compatible)",
	"backupsPage.offsite.description": "Daily push local backups to an S3-compatible endpoint; configure and dry-run via the Offsite Backup section on the Settings page.",
	"backupsPage.offsite.status.enabled": "Enabled",
	"backupsPage.offsite.status.disabled": "Disabled",
	"backupsPage.offsite.provider": "Provider: {provider}",
	"backupsPage.offsite.bucket": "Bucket: {bucket}",
	"backupsPage.offsite.region": "Region: {region}",
	"backupsPage.offsite.window": "Daily push window: {hour}:00 (UTC)",
	"backupsPage.offsite.retention": "Retention: {days} days",
	"backupsPage.offsite.dryRunLast": "Last dry-run: {status} · {latencyMs}ms",
	"backupsPage.offsite.dryRunNever": "No dry-run has been executed yet",
	"backupsPage.offsite.dryRunButton": "Run dry-run now",
	"backupsPage.offsite.dryRunning": "Running…",
	"backupsPage.offsite.dryRunOk": "dry-run succeeded, latency {latencyMs}ms",
	"backupsPage.offsite.dryRunFailed": "dry-run failed: {message}",
	"backupsPage.offsite.dryRunDisabled": "Offsite backup is not enabled",
	"backupsPage.offsite.openSettings": "Open settings",
};
