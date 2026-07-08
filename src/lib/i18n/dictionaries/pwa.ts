/**
 * i18n dictionary: `pwa.*` — PWA install prompt + offline fallback copy.
 *
 * The offline page (src/app/offline/page.tsx) and the PwaRegister
 * client component (src/components/pwa-register.tsx) both consume
 * these keys. Translation parity between zh and en is required
 * for the i18n coverage check to pass.
 */
export const zh: Record<string, string> = {
	"pwa.install.description": "将 VControlHub 添加到主屏幕,获得接近原生应用的使用体验。",
	"pwa.install.installed": "已添加到主屏幕",
	"pwa.install.iosHint": "在 iOS Safari 中,点击分享按钮,然后选择「添加到主屏幕」。",
	"pwa.install.title": "安装 VControlHub",
	"pwa.offline.cachedRoutes": "可离线访问",
	"pwa.offline.dashboard": "仪表盘",
	"pwa.offline.description": "网络连接已断开,以下只读页面在之前访问过的话仍然可用。如需执行命令、查看最新数据等操作,请等待网络恢复后重试。",
	"pwa.offline.files": "文件管理",
	"pwa.offline.retry": "重试连接",
	"pwa.offline.retrying": "重连中…",
	"pwa.offline.servers": "VPS 管理",
	"pwa.offline.settings": "系统设置",
	"pwa.offline.title": "当前离线",
	"pwa.register.failed": "Service Worker 注册失败,部分离线功能不可用。",
	"pwa.register.unsupported": "当前浏览器不支持 Service Worker,PWA 功能不可用。",
	"pwa.status.offline": "网络已断开,将使用可用的离线缓存。",
	"pwa.status.offlineDescription": "只读页面可继续浏览缓存内容；命令执行、文件变更和实时数据会在联网后恢复。",
	"pwa.status.offlineTitle": "当前处于离线模式",
	"pwa.status.online": "网络已恢复。",
	"pwa.update.available": "新版本可用",
	"pwa.update.description": "页面已更新,点击刷新以加载最新内容。",
	"pwa.update.dismiss": "稍后",
	"pwa.update.refresh": "立即刷新",
};

export const en: Record<string, string> = {
	"pwa.install.description": "Add VControlHub to your home screen for a near-native experience.",
	"pwa.install.installed": "Added to home screen",
	"pwa.install.iosHint": "In iOS Safari, tap the share button and choose 'Add to Home Screen'.",
	"pwa.install.title": "Install VControlHub",
	"pwa.offline.cachedRoutes": "Available offline",
	"pwa.offline.dashboard": "Dashboard",
	"pwa.offline.description": "Network is disconnected. The following read-only pages may still load from cache. Live data, command execution, and other online actions will resume once the network is back.",
	"pwa.offline.files": "Files",
	"pwa.offline.retry": "Retry connection",
	"pwa.offline.retrying": "Retrying…",
	"pwa.offline.servers": "VPS management",
	"pwa.offline.settings": "Settings",
	"pwa.offline.title": "You're offline",
	"pwa.register.failed": "Service worker registration failed; some offline features are unavailable.",
	"pwa.register.unsupported": "Your browser does not support service workers; PWA features are unavailable.",
	"pwa.status.offline": "Network disconnected. Available offline cache will be used.",
	"pwa.status.offlineDescription": "Read-only pages can continue from cache. Commands, file changes, and live data resume when the network is back.",
	"pwa.status.offlineTitle": "Offline mode is active",
	"pwa.status.online": "Network connection restored.",
	"pwa.update.available": "New version available",
	"pwa.update.description": "A new version is ready. Refresh to load the latest content.",
	"pwa.update.dismiss": "Later",
	"pwa.update.refresh": "Refresh now",
};
