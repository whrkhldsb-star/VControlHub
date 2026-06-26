import type { ReactNode } from "react";

export interface AppNavItem {
	href: string;
	labelKey: string;
	fallbackLabel: string;
	icon: ReactNode;
}

export const IconDashboard = () => <svg width="18" height="18" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1h-2z" /></svg>;
export const IconServer = () => <svg width="18" height="18" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" /></svg>;
export const IconFolder = () => <svg width="18" height="18" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>;
export const IconDownload = () => <svg width="18" height="18" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>;
export const IconCheck = () => <svg width="18" height="18" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
export const IconUsers = () => <svg width="18" height="18" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>;
export const IconAudit = () => <svg width="18" height="18" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>;
export const IconMovie = () => <svg width="18" height="18" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" /></svg>;
export const IconKey = () => <svg width="18" height="18" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.857L8 16H6v2H4v2H2v-2.586l7.44-7.44A6 6 0 0121 9z" /></svg>;
export const IconExternal = () => <svg className="w-3 h-3 ml-auto text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>;
export const IconBell = () => <svg width="18" height="18" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>;
export const IconClock = () => <svg width="18" height="18" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
export const IconSettings = () => <svg width="18" height="18" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>;
export const IconHeart = () => <svg width="18" height="18" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>;
export const IconTemplate = () => <svg width="18" height="18" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>;
export const IconAlert = () => <svg width="18" height="18" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>;
export const IconTask = () => <svg width="18" height="18" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5h6M9 12h6m-6 7h6M5 5h.01M5 12h.01M5 19h.01" /></svg>;
export const IconShare = () => <svg width="18" height="18" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.684 13.342C8.886 12.938 9 12.482 9 12s-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-5.974l6.632-3.316M18 9a3 3 0 100-6 3 3 0 000 6zm0 12a3 3 0 100-6 3 3 0 000 6z" /></svg>;
export const IconBackup = () => <svg width="18" height="18" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v6h6M20 20v-6h-6M5 19A9 9 0 0019 5M19 5h-5m5 0v5" /></svg>;
export const IconCode = () => <svg width="18" height="18" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 18l6-6-6-6M8 6l-6 6 6 6" /></svg>;
export const IconTicket = () => <svg width="18" height="18" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 5H9a2 2 0 00-2 2v12l5-3 5 3V7a2 2 0 00-2-2z" /></svg>;
export const IconStatus = () => <svg width="18" height="18" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12h4l3 8 4-16 3 8h4" /></svg>;
export const IconTraffic = () => <svg width="18" height="18" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 17h16M4 12h5l2-5 4 10 2-5h3" /></svg>;
export const IconDeploy = () => <svg width="18" height="18" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>;
export const IconAi = () => <svg width="18" height="18" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.09-.75.202-.25.112-.499.268-.75.468M9.75 3.104c.251.023.501.09.75.202.25.112.499.268.75.468M5 14.5l-1.43 1.43a2.25 2.25 0 01-3.182 0l-.03-.03a2.25 2.25 0 010-3.182L5 14.5zm0 0l6.25-6.25" /></svg>;
export const IconImage = () => <svg width="18" height="18" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>;
export const IconStore = () => <svg width="18" height="18" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v0A2.25 2.25 0 018.25 8.25H6A2.25 2.25 0 013.75 6v0zM13.5 6a2.25 2.25 0 012.25-2.25h2.25A2.25 2.25 0 0120.25 6v0a2.25 2.25 0 01-2.25 2.25h-2.25A2.25 2.25 0 0113.5 6v0zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25v0a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25v0z" /></svg>;

export const mainNavItems: AppNavItem[] = [
	{ href: "/dashboard", labelKey: "nav.dashboard", fallbackLabel: "仪表盘", icon: <IconDashboard /> },
	{ href: "/servers", labelKey: "nav.servers", fallbackLabel: "VPS 管理", icon: <IconServer /> },
	{ href: "/health", labelKey: "nav.health", fallbackLabel: "健康看板", icon: <IconHeart /> },
	{ href: "/monitoring", labelKey: "nav.monitoring", fallbackLabel: "服务器监控", icon: <IconTraffic /> },
	{ href: "/traffic", labelKey: "nav.traffic", fallbackLabel: "流量中心", icon: <IconTraffic /> },
	{ href: "/files", labelKey: "nav.storage", fallbackLabel: "文件管理", icon: <IconFolder /> },
	{ href: "/downloads", labelKey: "nav.downloads", fallbackLabel: "远程下载", icon: <IconDownload /> },
	{ href: "/operation-tasks", labelKey: "nav.operation-tasks", fallbackLabel: "任务中心", icon: <IconTask /> },
	{ href: "/shares", labelKey: "nav.share-links", fallbackLabel: "分享链接", icon: <IconShare /> },
	{ href: "/backups", labelKey: "nav.backup", fallbackLabel: "备份迁移", icon: <IconBackup /> },
	{ href: "/cost-summary", labelKey: "nav.cost-summary", fallbackLabel: "成本追踪", icon: <IconTraffic /> },
	{ href: "/templates", labelKey: "nav.command-templates", fallbackLabel: "命令模板", icon: <IconTemplate /> },
	{ href: "/deployments", labelKey: "nav.deployments", fallbackLabel: "应用部署", icon: <IconDeploy /> },
	{ href: "/quick-services", labelKey: "nav.quickservice", fallbackLabel: "快捷服务", icon: <IconStore /> },
	{ href: "/snippets", labelKey: "nav.snippets", fallbackLabel: "代码片段", icon: <IconCode /> },
	{ href: "/media", labelKey: "nav.media", fallbackLabel: "媒体库", icon: <IconMovie /> },
	{ href: "/image-bed", labelKey: "nav.image-bed", fallbackLabel: "外链管理", icon: <IconImage /> },
	{ href: "/ai", labelKey: "nav.ai", fallbackLabel: "AI 助手", icon: <IconAi /> },
	{ href: "/ai-ops", labelKey: "nav.ai-ops", fallbackLabel: "智能运维", icon: <IconAi /> },
	{ href: "/announcements", labelKey: "nav.announcements", fallbackLabel: "站内公告", icon: <IconBell /> },
	{ href: "/tickets", labelKey: "nav.tickets", fallbackLabel: "工单请求", icon: <IconTicket /> },
	{ href: "/requests", labelKey: "nav.requests", fallbackLabel: "审批中心", icon: <IconCheck /> },
	{ href: "/scheduled-tasks", labelKey: "nav.scheduled-tasks", fallbackLabel: "定时任务", icon: <IconClock /> },
	{ href: "/playbooks", labelKey: "nav.playbooks", fallbackLabel: "Playbook 自动化", icon: <IconAlert /> },
	{ href: "/alert-rules", labelKey: "nav.alert-rules", fallbackLabel: "智能告警", icon: <IconAlert /> },
	{ href: "/notifications", labelKey: "nav.notifications", fallbackLabel: "通知中心", icon: <IconBell /> },
	{ href: "/settings", labelKey: "nav.settings", fallbackLabel: "设置", icon: <IconSettings /> },
];

export const systemNavItems: AppNavItem[] = [
	{ href: "/users", labelKey: "nav.users", fallbackLabel: "用户管理", icon: <IconUsers /> },
	{ href: "/api-tokens", labelKey: "nav.api-tokens", fallbackLabel: "API Token", icon: <IconKey /> },
	{ href: "/status", labelKey: "nav.status", fallbackLabel: "公开状态页", icon: <IconStatus /> },
	{ href: "/audit", labelKey: "nav.audit", fallbackLabel: "审计日志", icon: <IconAudit /> },
	{ href: "/qa-reports", labelKey: "nav.qa-reports", fallbackLabel: "QA 报告", icon: <IconCheck /> },
];

const mobileNavHrefs = ["/dashboard", "/servers", "/traffic", "/files", "/settings"] as const;

export const mobileNavItems: AppNavItem[] = mobileNavHrefs.map((href) => {
	const item = mainNavItems.find((navItem) => navItem.href === href);
	if (!item) {
		throw new Error(`Missing mobile navigation item for href: ${href}`);
	}
	return item;
});
