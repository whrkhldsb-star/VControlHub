/**
 * i18n dictionary: `apiServersFileProxy.*` — file-proxy API endpoints (R26).
 */
export const zh: Record<string, string> = {
	"apiServersFileProxy.getErrorMessage": "文件代理状态获取失败",
	"apiServersFileProxy.startErrorMessage": "启动文件代理失败",
	"apiServersFileProxy.stopErrorMessage": "停止文件代理失败",
	"apiServersFileProxy.serverNotFound": "服务器不存在",
	"apiServersFileProxy.missingPublicUrl": "服务器未配置公网访问地址（publicUrl），无法启用直连模式",
	"apiServersFileProxy.missingStorageNode": "服务器未绑定 SFTP 存储节点，无法确定文件代理根目录",
	"apiServersFileProxy.endpointMismatch": "SFTP 存储节点与服务器 SSH 端点不同，请使用存储中转。",
	"apiServersFileProxy.stillRunning": "文件代理仍在运行，请重试停止操作。",
	"apiServersFileProxy.unknownStatus": "无法确认远端文件代理状态，请检查 SSH 连接后重试。",
	"apiServersFileProxy.startFailed": "启动文件代理失败",
	"apiServersFileProxy.startTimeout": "文件代理启动超时（未就绪）",
	"apiServersFileProxy.operationFailed": "操作失败",
};

export const en: Record<string, string> = {
	"apiServersFileProxy.getErrorMessage": "Failed to fetch file-proxy status",
	"apiServersFileProxy.startErrorMessage": "Failed to start file proxy",
	"apiServersFileProxy.stopErrorMessage": "Failed to stop file proxy",
	"apiServersFileProxy.serverNotFound": "Server not found",
	"apiServersFileProxy.missingPublicUrl": "Server has no publicUrl configured; direct mode is unavailable.",
	"apiServersFileProxy.missingStorageNode": "Server is not bound to an SFTP storage node; cannot determine file-proxy root.",
	"apiServersFileProxy.endpointMismatch": "The SFTP storage node uses a different SSH endpoint. Use managed storage access.",
	"apiServersFileProxy.stillRunning": "The file proxy is still running. Retry the stop operation.",
	"apiServersFileProxy.unknownStatus": "Unable to confirm the remote file proxy status. Check SSH connectivity and retry.",
	"apiServersFileProxy.startFailed": "Failed to start file proxy",
	"apiServersFileProxy.startTimeout": "File proxy startup timed out (not ready)",
	"apiServersFileProxy.operationFailed": "Operation failed",
};
