/**
 * i18n dictionary: `backend.*` — server-side error messages thrown from
 * src/lib service modules (deploy-export, storage, share-link, operation-task).
 *
 * These keys are resolved via the synchronous `t(key, locale)` helper for
 * functions that cannot be async (e.g. `normalizeSharePath`,
 * `resolveLocalAbsolutePath`, `sanitizeAppName`), and via `serverT()` for
 * async service functions. The default locale is "zh" when no request scope
 * is available (unit tests, background tasks).
 */

export const zh: Record<string, string> = {
	// deploy-export/service.ts
	"backend.deployExport.appNameInvalid": "应用名称只能包含小写字母、数字和连字符，且必须以字母开头",
	"backend.deployExport.domainInvalid": "域名格式不合法",
	"backend.deployExport.templateContainsSecrets": "部署包模板包含敏感内容，已拒绝导出",

	// storage/service-entries.ts
	"backend.storage.invalidPath": "非法路径",
	"backend.storage.pathAlreadyExists": "路径已存在: {path}",
	"backend.storage.fileEntryNotFound": "文件条目不存在或已删除",
	"backend.storage.originalFileMissing": "原始文件已不存在，无法恢复索引",
	"backend.storage.originalPathNotDirectory": "原始路径已不是目录，无法恢复索引",
	"backend.storage.originalPathNotFile": "原始路径已不是文件，无法恢复索引",
	"backend.storage.remotePathInvalid": "原始远端路径非法，无法恢复索引",
	"backend.storage.remoteFileCheckFailed": "无法确认远端文件仍然存在，恢复已取消",
	"backend.storage.remoteFileMissing": "原始远端文件已不存在，无法恢复索引",
	"backend.storage.remotePathNotDirectory": "原始远端路径已不是目录，无法恢复索引",
	"backend.storage.remotePathNotFile": "原始远端路径已不是文件，无法恢复索引",
	"backend.storage.fileEntryNotInRecycleBin": "文件条目未在回收站中",

	// storage/service-editable.ts
	"backend.storage.editableEntryNotFound": "文件条目不存在或已删除",
	"backend.storage.editableLocalOnly": "仅支持编辑已上传到当前服务器本机存储节点的文件",
	"backend.storage.editableNoAccess": "没有该存储节点或路径的访问授权",
	"backend.storage.editableTextOnly": "当前仅支持编辑文本类文件",
	"backend.storage.editableTargetNotFile": "目标不是可编辑文件",
	"backend.storage.editableFileTooLarge": "文件超过 512 KB，暂不支持在线编辑",
	"backend.storage.editableFileUpdatedByOther": "文件已被其他操作更新，请重新加载后再保存",
	"backend.storage.editableFileChangedOnDisk": "文件内容已在磁盘上发生变化，请重新加载后再保存",

	// share-link/service.ts
	"backend.shareLink.invalidSharePath": "分享路径必须是存储节点内的安全相对路径",
	"backend.shareLink.noSharePermission": "没有该路径的分享权限",
	"backend.shareLink.fileNotFound": "文件不存在或已删除",
	"backend.shareLink.notFoundOrRevoked": "分享链接不存在或已撤销",
	"backend.shareLink.expired": "分享链接已过期",
	"backend.shareLink.maxDownloadsExceeded": "分享链接已达最大下载次数",
	"backend.shareLink.passwordRequired": "该分享链接需要密码访问",
	"backend.shareLink.passwordIncorrect": "访问密码错误",

	// operation-task/service.ts
	"backend.operationTask.heartbeat": "心跳",
	"backend.operationTask.heartbeatUnknown": "心跳未知",
	"backend.operationTask.workerUnknown": "未知",
	"backend.operationTask.workerProgress": "后台执行器 {workerId} · {heartbeat}",
	"backend.operationTask.failure.authOrPermission": "权限或认证失败",
	"backend.operationTask.failure.timeout": "执行超时",
	"backend.operationTask.failure.fileOrResourceNotFound": "文件或资源不存在",
	"backend.operationTask.failure.networkOrConnection": "网络或连接失败",
	"backend.operationTask.failure.notification": "通知发送失败",
	"backend.operationTask.failure.backupOrRestore": "备份或恢复失败",
	"backend.operationTask.failure.taskTypeFailed": "{taskType} 失败",
	"backend.operationTask.failure.sourceFailed": "{source} 失败",
	"backend.operationTask.backupTitle": "{type} 备份",

	// server/service-profiles.ts, server/service-direct-gateway.ts
	"backend.server.nodeNotFound": "VPS 节点不存在或已删除",
	// storage/service-nodes.ts, storage/sftp-sync-job.ts
	"backend.storage.nodeNotFound": "存储节点不存在或已删除",
	"backend.storage.nodeNotFoundShort": "存储节点不存在",
};

export const en: Record<string, string> = {
	// deploy-export/service.ts
	"backend.deployExport.appNameInvalid": "App name must contain only lowercase letters, digits, and hyphens, and must start with a letter",
	"backend.deployExport.domainInvalid": "Invalid domain format",
	"backend.deployExport.templateContainsSecrets": "Deployment package template contains sensitive content; export refused",

	// storage/service-entries.ts
	"backend.storage.invalidPath": "Invalid path",
	"backend.storage.pathAlreadyExists": "Path already exists: {path}",
	"backend.storage.fileEntryNotFound": "File entry not found or has been deleted",
	"backend.storage.originalFileMissing": "The original file no longer exists; cannot restore the index",
	"backend.storage.originalPathNotDirectory": "The original path is no longer a directory; cannot restore the index",
	"backend.storage.originalPathNotFile": "The original path is no longer a file; cannot restore the index",
	"backend.storage.remotePathInvalid": "The original remote path is invalid; cannot restore the index",
	"backend.storage.remoteFileCheckFailed": "Cannot confirm the remote file still exists; restore cancelled",
	"backend.storage.remoteFileMissing": "The original remote file no longer exists; cannot restore the index",
	"backend.storage.remotePathNotDirectory": "The original remote path is no longer a directory; cannot restore the index",
	"backend.storage.remotePathNotFile": "The original remote path is no longer a file; cannot restore the index",
	"backend.storage.fileEntryNotInRecycleBin": "File entry is not in the recycle bin",

	// storage/service-editable.ts
	"backend.storage.editableEntryNotFound": "File entry not found or has been deleted",
	"backend.storage.editableLocalOnly": "Only files uploaded to the local storage node on this server can be edited",
	"backend.storage.editableNoAccess": "No access permission for this storage node or path",
	"backend.storage.editableTextOnly": "Only text-type files can be edited at this time",
	"backend.storage.editableTargetNotFile": "The target is not an editable file",
	"backend.storage.editableFileTooLarge": "File exceeds 512 KB; online editing is not supported",
	"backend.storage.editableFileUpdatedByOther": "The file has been updated by another operation; please reload before saving",
	"backend.storage.editableFileChangedOnDisk": "The file content has changed on disk; please reload before saving",

	// share-link/service.ts
	"backend.shareLink.invalidSharePath": "The share path must be a safe relative path within the storage node",
	"backend.shareLink.noSharePermission": "No permission to share this path",
	"backend.shareLink.fileNotFound": "File not found or has been deleted",
	"backend.shareLink.notFoundOrRevoked": "Share link not found or has been revoked",
	"backend.shareLink.expired": "Share link has expired",
	"backend.shareLink.maxDownloadsExceeded": "Share link has reached the maximum number of downloads",
	"backend.shareLink.passwordRequired": "This share link requires a password to access",
	"backend.shareLink.passwordIncorrect": "Incorrect access password",

	// operation-task/service.ts
	"backend.operationTask.heartbeat": "Heartbeat",
	"backend.operationTask.heartbeatUnknown": "Heartbeat unknown",
	"backend.operationTask.workerUnknown": "unknown",
	"backend.operationTask.workerProgress": "Worker {workerId} · {heartbeat}",
	"backend.operationTask.failure.authOrPermission": "Permission or authentication failure",
	"backend.operationTask.failure.timeout": "Execution timed out",
	"backend.operationTask.failure.fileOrResourceNotFound": "File or resource not found",
	"backend.operationTask.failure.networkOrConnection": "Network or connection failure",
	"backend.operationTask.failure.notification": "Notification delivery failed",
	"backend.operationTask.failure.backupOrRestore": "Backup or restore failed",
	"backend.operationTask.failure.taskTypeFailed": "{taskType} failed",
	"backend.operationTask.failure.sourceFailed": "{source} failed",
	"backend.operationTask.backupTitle": "{type} backup",

	// server/service-profiles.ts, server/service-direct-gateway.ts
	"backend.server.nodeNotFound": "VPS node not found or has been deleted",
	// storage/service-nodes.ts, storage/sftp-sync-job.ts
	"backend.storage.nodeNotFound": "Storage node not found or has been deleted",
	"backend.storage.nodeNotFoundShort": "Storage node not found",
};
