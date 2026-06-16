/**
 * i18n dictionary: `officePreview.*` (5 keys).
 */
export const zh: Record<string, string> = {
	"officePreview.title": "此 Office 文件暂不支持稳定在线渲染预览",
	"officePreview.desc": "Office Online 需要 Microsoft 服务器直接访问文件 URL；当前文件预览使用登录态保护的主站受控流，不会把私有文件暴露为公网直连地址。请下载后使用本地软件打开。",
	"officePreview.download": "⬇ 下载文件",
	"officePreview.fileName": "文件名：{name}",
};

export const en: Record<string, string> = {
	"officePreview.title": "This Office file is not supported for stable online preview",
	"officePreview.desc": "Office Online requires Microsoft servers to access the file URL directly. Our preview flow keeps private files behind the authenticated main app and never exposes them as public direct links. Please download and open the file locally.",
	"officePreview.download": "⬇ Download file",
	"officePreview.fileName": "File name: {name}",
};
