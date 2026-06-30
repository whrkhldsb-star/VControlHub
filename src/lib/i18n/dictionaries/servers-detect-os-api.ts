/**
 * i18n dictionary: `apiServersDetectOs.*` — POST /api/servers/[id]/detect-os (TR-041).
 */
export const zh: Record<string, string> = {
	"apiServersDetectOs.unauthorized": "未登录或会话已过期",
	"apiServersDetectOs.missingSshPermission": "缺少服务器 SSH 权限",
	"apiServersDetectOs.serverNotFound": "服务器不存在",
	"apiServersDetectOs.detectionFailed": "OS 方言探测失败：{message}",
};

export const en: Record<string, string> = {
	"apiServersDetectOs.unauthorized": "Not signed in or session expired",
	"apiServersDetectOs.missingSshPermission": "Missing SSH permission for this server",
	"apiServersDetectOs.serverNotFound": "Server not found",
	"apiServersDetectOs.detectionFailed": "OS dialect detection failed: {message}",
};
