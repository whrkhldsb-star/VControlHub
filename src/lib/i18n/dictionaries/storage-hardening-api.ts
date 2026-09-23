/**
 * i18n dictionary: server-side hardening copy for the storage/files domain
 * (snapshot limits, WebDAV batch operations, copy/move paths).
 *
 * Domain-owned by the storage area — only storage-area changes add keys here,
 * which keeps parallel edits off the shared service-translations.ts barrel.
 */
export const zh: Record<string, string> = {
	// Access-denial copy for assertStorageAccess decision codes (see
	// src/lib/storage/access-denied.ts for the code → key mapping).
	"backend.storageHardening.access.noPermission":
		"缺少执行该操作所需的存储权限",
	"backend.storageHardening.access.noAccess":
		"没有此存储节点或路径的访问授权",
	"backend.storageHardening.access.pathNotAllowed":
		"请求路径无效或超出授权范围",
	"backend.storageHardening.access.fileTooLarge":
		"上传文件超出此授权的单文件大小限制",
	"backend.storageHardening.access.quotaExceeded":
		"本次写入将超出此授权的容量配额",

	// File-manager operations (delete / move / copy).
	"backend.storageHardening.files.childDeleteDenied":
		"目录中存在无删除权限的子项，无法删除该目录",
	"backend.storageHardening.files.tooManyChildren":
		"目录子项超过 10000 个，请分批操作",
	"backend.storageHardening.files.tooManyShares":
		"移动的条目关联了超过 10000 个有效分享链接",

	// Download / archive transport errors.
	"backend.storageHardening.sftp.targetNotFile": "目标不是可下载的文件",
	"backend.storageHardening.storage.missingConnectionCredentials":
		"缺少远程主机地址或连接凭据，无法建立连接",

	// Archive extraction safety.
	"backend.storageHardening.extract.gzOutputTooLarge":
		"解压后的内容超出大小上限，已中止解压并清理半成品文件",

	// WebDAV transport.
	"backend.storageHardening.webdav.payloadTooLarge":
		"请求体过大（上限 {max}）",
};

export const en: Record<string, string> = {
	"backend.storageHardening.access.noPermission":
		"Missing the storage permission required for this operation",
	"backend.storageHardening.access.noAccess":
		"No access authorization for this storage node or path",
	"backend.storageHardening.access.pathNotAllowed":
		"The requested path is invalid or outside the granted scope",
	"backend.storageHardening.access.fileTooLarge":
		"The uploaded file exceeds the single-file size limit of this authorization",
	"backend.storageHardening.access.quotaExceeded":
		"This write would exceed the capacity quota of this authorization",

	"backend.storageHardening.files.childDeleteDenied":
		"The directory contains a sub-entry you may not delete; it cannot be deleted",
	"backend.storageHardening.files.tooManyChildren":
		"Directory has more than 10000 children; split the operation",
	"backend.storageHardening.files.tooManyShares":
		"The moved entry has more than 10000 active share links",

	"backend.storageHardening.sftp.targetNotFile":
		"Target is not a downloadable file",
	"backend.storageHardening.storage.missingConnectionCredentials":
		"Missing remote host address or connection credentials",

	"backend.storageHardening.extract.gzOutputTooLarge":
		"Decompressed content exceeds the size limit; extraction was aborted and the partial file removed",

	"backend.storageHardening.webdav.payloadTooLarge":
		"Payload too large (max {max})",
};
