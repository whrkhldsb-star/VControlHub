/**
 * i18n dictionary: `apiServersReload.*` — POST /api/servers/[id]/reload (R26).
 */
export const zh: Record<string, string> = {
	"apiServersReload.errorMessage": "服务重载失败",
	"apiServersReload.unauthorized": "未登录或会话已过期",
	"apiServersReload.missingSshPermission": "缺少服务器 SSH 权限",
	"apiServersReload.serverNotFound": "服务器不存在",
	"apiServersReload.remoteExecutionFailed": "远端执行失败",
	"apiServersReload.reloadFailedWithMessage": "重载失败：{message}",
	"apiServersReload.unitNamePatternError": "unit 名称只允许字母数字 . _ - @",
	"apiServersReload.projectDirPatternError": "projectDir 必须是绝对路径且不含 shell 元字符",
};

export const en: Record<string, string> = {
	"apiServersReload.errorMessage": "Service reload failed",
	"apiServersReload.unauthorized": "Not signed in or session expired",
	"apiServersReload.missingSshPermission": "Missing SSH permission for this server",
	"apiServersReload.serverNotFound": "Server not found",
	"apiServersReload.remoteExecutionFailed": "Remote execution failed",
	"apiServersReload.reloadFailedWithMessage": "Reload failed: {message}",
	"apiServersReload.unitNamePatternError": "unit name may only contain letters, digits, . _ - @",
	"apiServersReload.projectDirPatternError": "projectDir must be an absolute path with no shell metacharacters",
};
