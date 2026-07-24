/**
 * Shared API-layer messages (route handlers). Prefer domain-specific
 * dictionaries (apiDownloads.*, vpsBackupApi.*) when available.
 */

export const zh: Record<string, string> = {
	"api.unauthorized": "未认证",
	"api.serverError": "服务器错误",
	"api.creationFailed": "创建失败",
	"api.updateFailed": "更新失败",
	"api.deleteFailed": "删除失败",
	"api.missingTaskId": "缺少任务 ID",
	"api.cronRequired": "请填写 Cron 表达式",
	"api.syncJobNotFound": "同步任务不存在",
	"api.syncJobRunFailed": "同步任务执行失败",
	"api.backupNotFound": "备份记录不存在",
	"api.onlyCompletedCanDrill": "只有已完成的备份可以演练",
	"api.onlyCompletedCanRestore": "只有已完成的备份可以恢复",
	"api.imageNotFound": "图片不存在",
};

export const en: Record<string, string> = {
	"api.unauthorized": "Unauthorized",
	"api.serverError": "Server error",
	"api.creationFailed": "Creation failed",
	"api.updateFailed": "Update failed",
	"api.deleteFailed": "Delete failed",
	"api.missingTaskId": "Missing task ID",
	"api.cronRequired": "Cron expression is required",
	"api.syncJobNotFound": "Sync job not found",
	"api.syncJobRunFailed": "Failed to run sync job",
	"api.backupNotFound": "Backup record not found",
	"api.onlyCompletedCanDrill": "Only completed backups can be drilled",
	"api.onlyCompletedCanRestore": "Only completed backups can be restored",
	"api.imageNotFound": "Image not found",
};
