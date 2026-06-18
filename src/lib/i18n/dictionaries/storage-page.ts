/**
 * i18n dictionary: `storagePage.*` (auto-generated).
 */
export const zh: Record<string, string> = {
	"storagePage.list.empty": "暂无存储节点。",

	"storagePage.list.health": "健康",

	"storagePage.list.error": "异常",

	"storagePage.list.unchecked": "未检测",

	"storagePage.list.defaultNode": "默认节点",

	"storagePage.list.edit": "编辑",

	"storagePage.list.collapse": "收起",

	"storagePage.list.lastChecked": "最近检测",

	"storagePage.list.registeredFiles": "已注册 {count} 个文件",

	"storagePage.action.healthCheckCompleted": "节点健康检查完成：{status}",
	"storagePage.action.healthCheckCompletedHealthy": "健康",
	"storagePage.action.healthCheckCompletedError": "异常",
	"storagePage.action.healthCheckFailed": "节点健康检查失败",

	"storagePage.action.createNodeSuccess": "存储节点已创建。",
	"storagePage.action.createNodeFailed": "创建存储节点失败",

	"storagePage.action.missingNodeParam": "缺少存储节点参数",
	"storagePage.action.missingFileEntryParam": "缺少文件条目参数",
	"storagePage.action.missingFolderName": "文件夹名称不能为空",
	"storagePage.action.missingEntryName": "名称不能为空",
	"storagePage.action.invalidEntryName": "名称包含非法字符",
	"storagePage.action.nodeNotFound": "存储节点不存在",
	"storagePage.action.fileEntryNotFound": "文件条目不存在",

	"storagePage.action.folderAlreadyExists": "路径 /{path} 已存在，请使用其他名称",
	"storagePage.action.folderCreated": "文件夹 /{path} 已创建",
	"storagePage.action.folderCreateFailed": "创建文件夹失败",

	"storagePage.action.fileMovedToRecycle": "已将 {name} 移至回收站",
	"storagePage.action.fileMovedToRecycleWithWarning": "已将 {name} 移至回收站；物理文件删除失败，索引仍可恢复或稍后重试永久删除：{warning}",
	"storagePage.action.fileDeleteFailed": "删除文件条目失败",
	"storagePage.action.fileRestoreFailed": "恢复文件条目失败",
	"storagePage.action.filePermanentlyDeleteFailed": "永久删除文件条目失败",

	"storagePage.action.fileRestored": "已恢复 {name}",
	"storagePage.action.filePermanentlyDeleted": "已永久删除 {name}",

	"storagePage.action.fileRenamed": "已重命名为 {name}",
	"storagePage.action.fileRenameFailed": "重命名文件条目失败",
	"storagePage.action.pathAlreadyExists": "路径 /{path} 已存在，请使用其他名称",

	"storagePage.action.updateNodeSuccess": "存储节点已更新。",
	"storagePage.action.updateNodeFailed": "更新存储节点失败",
	"storagePage.action.deleteNodeSuccess": "存储节点已删除。",
	"storagePage.action.deleteNodeFailed": "删除存储节点失败",

	"storagePage.action.physicalFileDeleteFailed": "物理文件删除失败",

	"storagePage.form.createTitle": "新增存储节点",
	"storagePage.form.createDescription": "支持本机存储与绑定 VPS 的 SFTP 存储节点。",
	"storagePage.form.editTitle": "编辑存储节点",
	"storagePage.form.fieldName": "节点名称",
	"storagePage.form.fieldDriver": "驱动",
	"storagePage.form.fieldBasePath": "根目录",
	"storagePage.form.fieldBindVps": "绑定 VPS",
	"storagePage.form.fieldBindVpsRequired": "*（SFTP 必填绑定VPS或远端主机）",
	"storagePage.form.fieldRemoteHost": "远端主机",
	"storagePage.form.fieldRemoteHostRequired": "*（SFTP 必填远端主机或绑定VPS）",
	"storagePage.form.fieldPort": "端口",
	"storagePage.form.fieldUsername": "用户名",
	"storagePage.form.fieldAccessMode": "访问模式",
	"storagePage.form.accessModeProxy": "网站服务器中转（最安全）",
	"storagePage.form.accessModeDirect": "存储服务器直连（需签名外链服务）",
	"storagePage.form.accessModeAuto": "自动：可直连则直连，否则中转",
	"storagePage.form.fieldPublicBaseUrl": "直连基础 URL",
	"storagePage.form.fieldDirectExpiresSeconds": "直连链接有效期（秒）",
	"storagePage.form.fieldIsDefault": "设为默认存储节点",
	"storagePage.form.optionNotBound": "不绑定",
	"storagePage.form.submitCreate": "创建节点",
	"storagePage.form.submitEdit": "保存修改",
	"storagePage.form.submitPending": "提交中...",
	"storagePage.form.basePathPlaceholder": "/srv/storage 或 /data/media",
	"storagePage.form.hostPlaceholder": "203.0.113.20",
	"storagePage.form.publicBaseUrlPlaceholder": "https://cdn.example.com/media",
};

export const en: Record<string, string> = {
	"storagePage.list.empty": "No storage nodes yet.",

	"storagePage.list.health": "Healthy",

	"storagePage.list.error": "Error",

	"storagePage.list.unchecked": "Unchecked",

	"storagePage.list.defaultNode": "Default node",

	"storagePage.list.edit": "Edit",

	"storagePage.list.collapse": "Collapse",

	"storagePage.list.lastChecked": "Last checked",

	"storagePage.list.registeredFiles": "{count} registered files",

	"storagePage.action.healthCheckCompleted": "Health check complete: {status}",
	"storagePage.action.healthCheckCompletedHealthy": "Healthy",
	"storagePage.action.healthCheckCompletedError": "Error",
	"storagePage.action.healthCheckFailed": "Storage node health check failed",

	"storagePage.action.createNodeSuccess": "Storage node created.",
	"storagePage.action.createNodeFailed": "Failed to create storage node",

	"storagePage.action.missingNodeParam": "Missing storage node parameter",
	"storagePage.action.missingFileEntryParam": "Missing file entry parameter",
	"storagePage.action.missingFolderName": "Folder name cannot be empty",
	"storagePage.action.missingEntryName": "Name cannot be empty",
	"storagePage.action.invalidEntryName": "Name contains invalid characters",
	"storagePage.action.nodeNotFound": "Storage node not found",
	"storagePage.action.fileEntryNotFound": "File entry not found",

	"storagePage.action.folderAlreadyExists": "Path /{path} already exists. Please use a different name",
	"storagePage.action.folderCreated": "Folder /{path} created",
	"storagePage.action.folderCreateFailed": "Failed to create folder",

	"storagePage.action.fileMovedToRecycle": "{name} moved to recycle bin",
	"storagePage.action.fileMovedToRecycleWithWarning": "{name} moved to recycle bin; physical file deletion failed, the index can still be restored or you can retry permanent deletion later: {warning}",
	"storagePage.action.fileDeleteFailed": "Failed to delete file entry",
	"storagePage.action.fileRestoreFailed": "Failed to restore file entry",
	"storagePage.action.filePermanentlyDeleteFailed": "Failed to permanently delete file entry",

	"storagePage.action.fileRestored": "{name} restored",
	"storagePage.action.filePermanentlyDeleted": "{name} permanently deleted",

	"storagePage.action.fileRenamed": "Renamed to {name}",
	"storagePage.action.fileRenameFailed": "Failed to rename file entry",
	"storagePage.action.pathAlreadyExists": "Path /{path} already exists. Please use a different name",

	"storagePage.action.updateNodeSuccess": "Storage node updated.",
	"storagePage.action.updateNodeFailed": "Failed to update storage node",
	"storagePage.action.deleteNodeSuccess": "Storage node deleted.",
	"storagePage.action.deleteNodeFailed": "Failed to delete storage node",

	"storagePage.action.physicalFileDeleteFailed": "Physical file deletion failed",

	"storagePage.form.createTitle": "Add storage node",
	"storagePage.form.createDescription": "Supports local storage and SFTP storage nodes bound to a VPS.",
	"storagePage.form.editTitle": "Edit storage node",
	"storagePage.form.fieldName": "Node name",
	"storagePage.form.fieldDriver": "Driver",
	"storagePage.form.fieldBasePath": "Base path",
	"storagePage.form.fieldBindVps": "Bind VPS",
	"storagePage.form.fieldBindVpsRequired": "* (required for SFTP — bind a VPS or remote host)",
	"storagePage.form.fieldRemoteHost": "Remote host",
	"storagePage.form.fieldRemoteHostRequired": "* (required for SFTP — provide a remote host or bind a VPS)",
	"storagePage.form.fieldPort": "Port",
	"storagePage.form.fieldUsername": "Username",
	"storagePage.form.fieldAccessMode": "Access mode",
	"storagePage.form.accessModeProxy": "Website server relay (safest)",
	"storagePage.form.accessModeDirect": "Storage server direct (requires signed URL service)",
	"storagePage.form.accessModeAuto": "Auto: direct when possible, relay otherwise",
	"storagePage.form.fieldPublicBaseUrl": "Direct base URL",
	"storagePage.form.fieldDirectExpiresSeconds": "Direct link TTL (seconds)",
	"storagePage.form.fieldIsDefault": "Set as default storage node",
	"storagePage.form.optionNotBound": "Not bound",
	"storagePage.form.submitCreate": "Create node",
	"storagePage.form.submitEdit": "Save changes",
	"storagePage.form.submitPending": "Submitting...",
	"storagePage.form.basePathPlaceholder": "/srv/storage or /data/media",
	"storagePage.form.hostPlaceholder": "203.0.113.20",
	"storagePage.form.publicBaseUrlPlaceholder": "https://cdn.example.com/media",
};
