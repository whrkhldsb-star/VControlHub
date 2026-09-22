/**
 * TR-043: i18n dictionary for VPS remote backup API routes.
 */

export const zh = {
	"vpsBackupApi.errorForbidden": "权限不足",
	"vpsBackupApi.errorCreateFailed": "创建备份计划失败",
	"vpsBackupApi.errorUpdateFailed": "更新备份计划失败",
	"vpsBackupApi.errorDeleteFailed": "删除备份计划失败",
	"vpsBackupApi.errorDeleteRecordFailed": "删除备份记录失败",
	"vpsBackupApi.errorServerDisabled": "服务器已禁用",
	"vpsBackupApi.errorServerNotFound": "服务器不存在",
	"vpsBackupApi.errorTriggerFailed": "触发备份失败",
	"vpsBackupApi.errorNotCompleted": "备份尚未完成，无法下载",
	"vpsBackupApi.errorFileNotFound": "备份文件不存在",
	"vpsBackupApi.errorCustomPathsRequired": "自定义备份至少需要一条路径",
	"vpsBackupApi.errorScheduleNotFound": "备份计划不存在",
	"vpsBackupApi.errorRecordNotFound": "备份记录不存在",
	"vpsBackupApi.errorRetryNotFailed": "只有失败的备份记录才能重试",
	"vpsBackupApi.errorRetentionRange": "保留天数必须在 1 到 365 之间",
	"vpsBackupApi.errorDeleteRunningRecord": "备份正在运行，无法删除；请等待其完成或失败",
	"vpsBackupApi.errorPathEscapesRoot": "备份文件路径超出存储根目录",
};

export const en = {
	"vpsBackupApi.errorForbidden": "Insufficient permissions",
	"vpsBackupApi.errorCreateFailed": "Failed to create backup schedule",
	"vpsBackupApi.errorUpdateFailed": "Failed to update backup schedule",
	"vpsBackupApi.errorDeleteFailed": "Failed to delete backup schedule",
	"vpsBackupApi.errorDeleteRecordFailed": "Failed to delete backup record",
	"vpsBackupApi.errorServerDisabled": "Server is disabled",
	"vpsBackupApi.errorServerNotFound": "Server not found",
	"vpsBackupApi.errorTriggerFailed": "Failed to trigger backup",
	"vpsBackupApi.errorNotCompleted": "Backup has not completed yet",
	"vpsBackupApi.errorFileNotFound": "Backup file not found",
	"vpsBackupApi.errorCustomPathsRequired": "Custom backup requires at least one path",
	"vpsBackupApi.errorScheduleNotFound": "Backup schedule not found",
	"vpsBackupApi.errorRecordNotFound": "Backup record not found",
	"vpsBackupApi.errorRetryNotFailed": "Only failed backup records can be retried",
	"vpsBackupApi.errorRetentionRange": "Retention days must be between 1 and 365",
	"vpsBackupApi.errorDeleteRunningRecord": "Cannot delete a RUNNING backup record; wait for completion or failure",
	"vpsBackupApi.errorPathEscapesRoot": "Backup file path escapes the storage root",
};
