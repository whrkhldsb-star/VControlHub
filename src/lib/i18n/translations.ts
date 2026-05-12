/**
 * Simple i18n system — Chinese/English translations.
 * Uses React context + localStorage persistence.
 * No external deps — lightweight alternative to next-intl.
 */

export type Locale = "zh" | "en";

const translations: Record<Locale, Record<string, string>> = {
	zh: {
		// Navigation
		"nav.dashboard": "仪表盘",
		"nav.servers": "服务器管理",
		"nav.storage": "文件管理",
		"nav.downloads": "下载站",
		"nav.users": "用户管理",
		"nav.audit": "审计日志",
		"nav.docker": "Docker 容器",
		"nav.ai": "AI 助手",
		"nav.snippets": "代码片段",
		"nav.image-bed": "图床",
		"nav.quickservice": "快服务",
		"nav.monitoring": "服务器监控",
		"nav.backup": "备份恢复",
		"nav.ssh": "SSH 终端",
		"nav.settings": "系统设置",
		"nav.api-docs": "API 文档",
		"nav.tickets": "工单系统",
		"nav.deployments": "部署管理",
		"nav.announcements": "公告管理",
		"nav.share-links": "分享链接",
		"nav.api-tokens": "API 令牌",
		"nav.scheduled-tasks": "定时任务",
		"nav.command-templates": "命令模板",

		// Auth
		"auth.login": "登录",
		"auth.logout": "退出登录",
		"auth.username": "用户名",
		"auth.password": "密码",
		"auth.change-password": "修改密码",
		"auth.two-factor": "两步验证",
		"auth.2fa-enable": "开启两步验证",
		"auth.2fa-disable": "关闭两步验证",

		// Common
		"common.save": "保存",
		"common.cancel": "取消",
		"common.delete": "删除",
		"common.edit": "编辑",
		"common.create": "创建",
		"common.search": "搜索",
		"common.refresh": "刷新",
		"common.loading": "加载中...",
		"common.no-data": "暂无数据",
		"common.confirm": "确认",
		"common.back": "返回",
		"common.status": "状态",
		"common.actions": "操作",
		"common.name": "名称",
		"common.type": "类型",
		"common.size": "大小",
		"common.time": "时间",
		"common.success": "操作成功",
		"common.error": "操作失败",

		// Dashboard
		"dashboard.title": "仪表盘",
		"dashboard.welcome": "欢迎回来",
		"dashboard.quick-links": "快捷入口",
		"dashboard.recent-activity": "最近活动",
		"dashboard.audit-log": "审计日志",
		"dashboard.data-trends": "数据趋势",

		// Servers
		"servers.title": "服务器管理",
		"servers.add": "添加服务器",
		"servers.connect": "连接",
		"servers.online": "在线",
		"servers.offline": "离线",

		// Docker
		"docker.title": "Docker 容器",
		"docker.start": "启动",
		"docker.stop": "停止",
		"docker.restart": "重启",
		"docker.remove": "删除",
		"docker.logs": "日志",
		"docker.running": "运行中",
		"docker.exited": "已停止",

		// Monitoring
		"monitoring.title": "服务器监控",
		"monitoring.cpu": "CPU",
		"monitoring.memory": "内存",
		"monitoring.disk": "磁盘",
		"monitoring.network": "网络",
		"monitoring.auto-refresh": "自动刷新",
		"monitoring.top-processes": "Top 进程",

		// Theme
		"theme.dark": "深色模式",
		"theme.light": "浅色模式",
		"theme.toggle": "切换主题",

		// Search
		"search.placeholder": "搜索页面、操作...",
		"search.no-results": "未找到结果",
	},
	en: {
		// Navigation
		"nav.dashboard": "Dashboard",
		"nav.servers": "Servers",
		"nav.storage": "Files",
		"nav.downloads": "Downloads",
		"nav.users": "Users",
		"nav.audit": "Audit Log",
		"nav.docker": "Docker",
		"nav.ai": "AI Assistant",
		"nav.snippets": "Snippets",
		"nav.image-bed": "Image Bed",
		"nav.quickservice": "Quick Service",
		"nav.monitoring": "Monitoring",
		"nav.backup": "Backup",
		"nav.ssh": "SSH Terminal",
		"nav.settings": "Settings",
		"nav.api-docs": "API Docs",
		"nav.tickets": "Tickets",
		"nav.deployments": "Deployments",
		"nav.announcements": "Announcements",
		"nav.share-links": "Share Links",
		"nav.api-tokens": "API Tokens",
		"nav.scheduled-tasks": "Scheduled Tasks",
		"nav.command-templates": "Command Templates",

		// Auth
		"auth.login": "Login",
		"auth.logout": "Sign Out",
		"auth.username": "Username",
		"auth.password": "Password",
		"auth.change-password": "Change Password",
		"auth.two-factor": "Two-Factor Auth",
		"auth.2fa-enable": "Enable 2FA",
		"auth.2fa-disable": "Disable 2FA",

		// Common
		"common.save": "Save",
		"common.cancel": "Cancel",
		"common.delete": "Delete",
		"common.edit": "Edit",
		"common.create": "Create",
		"common.search": "Search",
		"common.refresh": "Refresh",
		"common.loading": "Loading...",
		"common.no-data": "No data",
		"common.confirm": "Confirm",
		"common.back": "Back",
		"common.status": "Status",
		"common.actions": "Actions",
		"common.name": "Name",
		"common.type": "Type",
		"common.size": "Size",
		"common.time": "Time",
		"common.success": "Success",
		"common.error": "Error",

		// Dashboard
		"dashboard.title": "Dashboard",
		"dashboard.welcome": "Welcome back",
		"dashboard.quick-links": "Quick Links",
		"dashboard.recent-activity": "Recent Activity",
		"dashboard.audit-log": "Audit Log",
		"dashboard.data-trends": "Data Trends",

		// Servers
		"servers.title": "Server Management",
		"servers.add": "Add Server",
		"servers.connect": "Connect",
		"servers.online": "Online",
		"servers.offline": "Offline",

		// Docker
		"docker.title": "Docker Containers",
		"docker.start": "Start",
		"docker.stop": "Stop",
		"docker.restart": "Restart",
		"docker.remove": "Remove",
		"docker.logs": "Logs",
		"docker.running": "Running",
		"docker.exited": "Exited",

		// Monitoring
		"monitoring.title": "Server Monitoring",
		"monitoring.cpu": "CPU",
		"monitoring.memory": "Memory",
		"monitoring.disk": "Disk",
		"monitoring.network": "Network",
		"monitoring.auto-refresh": "Auto Refresh",
		"monitoring.top-processes": "Top Processes",

		// Theme
		"theme.dark": "Dark Mode",
		"theme.light": "Light Mode",
		"theme.toggle": "Toggle Theme",

		// Search
		"search.placeholder": "Search pages, actions...",
		"search.no-results": "No results found",
	},
};

export function t(key: string, locale: Locale = "zh"): string {
	return translations[locale]?.[key] || key;
}

export function getAllTranslations(locale: Locale): Record<string, string> {
	return translations[locale] || translations.zh;
}
