/**
 * i18n dictionary: `apiShareToken.*` — Public share-link download API errors (R26).
 */
export const zh: Record<string, string> = {
	"apiShareToken.invalidToken": "分享链接无效",
	"apiShareToken.directoryNeedsChild": "请选择目录中的具体文件或使用 archive=1 下载整个目录",
	"apiShareToken.invalidPath": "非法路径",
	"apiShareToken.outOfRange": "文件不在分享目录范围内",
	"apiShareToken.notDownloadable": "分享目标不是可下载文件",
	"apiShareToken.notPackagable": "分享目标不是可打包目录",
	"apiShareToken.localNotFound": "文件不存在或暂时无法读取",
	"apiShareToken.missingRemoteCredentials": "缺少远端连接凭据",
	"apiShareToken.remoteNotFound": "远端文件不存在或暂时无法读取",
	"apiShareToken.unsupportedDriver": "该存储节点暂不支持公开分享下载",
};

export const en: Record<string, string> = {
	"apiShareToken.invalidToken": "Invalid share link",
	"apiShareToken.directoryNeedsChild": "Select a file in the directory or use archive=1 to download the whole directory.",
	"apiShareToken.invalidPath": "Invalid path",
	"apiShareToken.outOfRange": "File is outside the shared directory scope.",
	"apiShareToken.notDownloadable": "Share target is not a downloadable file.",
	"apiShareToken.notPackagable": "Share target is not a packagable directory.",
	"apiShareToken.localNotFound": "File does not exist or is temporarily unreadable.",
	"apiShareToken.missingRemoteCredentials": "Missing remote connection credentials.",
	"apiShareToken.remoteNotFound": "Remote file does not exist or is temporarily unreadable.",
	"apiShareToken.unsupportedDriver": "This storage node does not support public share downloads.",
};
