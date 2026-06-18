/**
 * i18n dictionary: `apiServersFileProxy.*` — file-proxy API endpoints (R26).
 */
export const zh: Record<string, string> = {
	"apiServersFileProxy.getErrorMessage": "文件代理状态获取失败",
	"apiServersFileProxy.startErrorMessage": "启动文件代理失败",
	"apiServersFileProxy.stopErrorMessage": "停止文件代理失败",
	"apiServersFileProxy.unauthorized": "未登录或会话已过期",
	"apiServersFileProxy.missingSshPermission": "缺少服务器 SSH 权限",
	"apiServersFileProxy.serverNotFound": "服务器不存在",
	"apiServersFileProxy.missingPublicUrl": "服务器未配置公网访问地址(publicUrl)，无法启用直连模式",
	"apiServersFileProxy.missingStorageNode": "服务器未绑定 SFTP 存储节点，无法确定文件代理根目录",
	"apiServersFileProxy.startFailed": "启动文件代理失败",
	"apiServersFileProxy.cannotDeterminePort": "无法确定代理端口",
	"apiServersFileProxy.operationFailed": "操作失败",
};

export const en: Record<string, string> = {
	"apiServersFileProxy.getErrorMessage": "Failed to fetch file-proxy status",
	"apiServersFileProxy.startErrorMessage": "Failed to start file proxy",
	"apiServersFileProxy.stopErrorMessage": "Failed to stop file proxy",
	"apiServersFileProxy.unauthorized": "Not signed in or session expired",
	"apiServersFileProxy.missingSshPermission": "Missing SSH permission for this server",
	"apiServersFileProxy.serverNotFound": "Server not found",
	"apiServersFileProxy.missingPublicUrl": "Server has no publicUrl configured; direct mode is unavailable.",
	"apiServersFileProxy.missingStorageNode": "Server is not bound to an SFTP storage node; cannot determine file-proxy root.",
	"apiServersFileProxy.startFailed": "Failed to start file proxy",
	"apiServersFileProxy.cannotDeterminePort": "Cannot determine proxy port",
	"apiServersFileProxy.operationFailed": "Operation failed",
};
