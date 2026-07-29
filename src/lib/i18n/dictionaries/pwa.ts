/**
 * i18n dictionary: `pwa.*` — PWA install prompt + offline fallback copy.
 *
 * The offline page (src/app/offline/page.tsx) and the PwaRegister
 * client component (src/components/pwa-register.tsx) both consume
 * these keys. Translation parity between zh and en is required
 * for the i18n coverage check to pass.
 */
export const zh: Record<string, string> = {
	"pwa.install.installed": "已添加到主屏幕",
	"pwa.offline.description": "网络连接已断开。请等待网络恢复后重试。",
	"pwa.offline.retry": "重试连接",
	"pwa.offline.retrying": "重连中…",
	"pwa.offline.securityNotice": "为保护服务器、文件和账户信息，登录后的页面不会存储到离线缓存。",
	"pwa.offline.title": "当前离线",
	"pwa.register.failed": "Service Worker 注册失败,部分离线功能不可用。",
	"pwa.status.offline": "网络已断开。",
	"pwa.status.offlineDescription": "登录后的数据不会离线存储；联网后可恢复访问。",
	"pwa.status.offlineTitle": "当前处于离线模式",
	"pwa.status.online": "网络已恢复。",
	"pwa.update.available": "新版本可用",
	"pwa.update.description": "页面已更新,点击刷新以加载最新内容。",
	"pwa.update.dismiss": "稍后",
	"pwa.update.refresh": "立即刷新",
};

export const en: Record<string, string> = {
	"pwa.install.installed": "Added to home screen",
	"pwa.offline.description": "The network is disconnected. Retry after the connection is restored.",
	"pwa.offline.retry": "Retry connection",
	"pwa.offline.retrying": "Retrying…",
	"pwa.offline.securityNotice": "Authenticated pages are not stored offline, protecting server, file, and account data.",
	"pwa.offline.title": "You're offline",
	"pwa.register.failed": "Service worker registration failed; some offline features are unavailable.",
	"pwa.status.offline": "Network disconnected.",
	"pwa.status.offlineDescription": "Authenticated data is not stored offline; access resumes when the connection returns.",
	"pwa.status.offlineTitle": "Offline mode is active",
	"pwa.status.online": "Network connection restored.",
	"pwa.update.available": "New version available",
	"pwa.update.description": "A new version is ready. Refresh to load the latest content.",
	"pwa.update.dismiss": "Later",
	"pwa.update.refresh": "Refresh now",
};
