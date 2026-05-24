"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { SignOutButton } from "./sign-out-button";
import { ChangePasswordModal } from "./change-password-modal";
import { NotificationBell } from "./notification-bell";
import { ThemeToggle } from "./theme-toggle";
import { LanguageToggle } from "./language-toggle";
import { TwoFactorSettings } from "./two-factor-settings";

/* ── SVG Icons ──────────────────────────────────────────────── */
const IconDashboard = () => <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1h-2z" /></svg>;
const IconServer = () => <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" /></svg>;
const IconFolder = () => <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>;
const IconDownload = () => <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>;
const IconCheck = () => <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
const IconUsers = () => <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>;
const IconAudit = () => <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>;
const IconMovie = () => <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" /></svg>;
const IconKey = () => <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.857L8 16H6v2H4v2H2v-2.586l7.44-7.44A6 6 0 0121 9z" /></svg>;
const IconExternal = () => <svg className="w-3 h-3 ml-auto text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>;
const IconBell = () => <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>;
const IconClock = () => <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
const IconSettings = () => <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>;
const IconHeart = () => <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>;
const IconTemplate = () => <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>;
const IconAlert = () => <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>;
const IconTask = () => <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5h6M9 12h6m-6 7h6M5 5h.01M5 12h.01M5 19h.01" /></svg>;
const IconShare = () => <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.684 13.342C8.886 12.938 9 12.482 9 12s-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-5.974l6.632-3.316M18 9a3 3 0 100-6 3 3 0 000 6zm0 12a3 3 0 100-6 3 3 0 000 6z" /></svg>;
const IconBackup = () => <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v6h6M20 20v-6h-6M5 19A9 9 0 0019 5M19 5h-5m5 0v5" /></svg>;
const IconCode = () => <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 18l6-6-6-6M8 6l-6 6 6 6" /></svg>;
const IconTicket = () => <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 5H9a2 2 0 00-2 2v12l5-3 5 3V7a2 2 0 00-2-2z" /></svg>;
const IconStatus = () => <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12h4l3 8 4-16 3 8h4" /></svg>;
const IconTraffic = () => <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 17h16M4 12h5l2-5 4 10 2-5h3" /></svg>;
const IconDeploy = () => <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>;
const IconAi = () => <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.09-.75.202-.25.112-.499.268-.75.468M9.75 3.104c.251.023.501.09.75.202.25.112.499.268.75.468M5 14.5l-1.43 1.43a2.25 2.25 0 01-3.182 0l-.03-.03a2.25 2.25 0 010-3.182L5 14.5zm0 0l6.25-6.25" /></svg>;
const IconImage = () => <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>;
const IconStore = () => <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v0A2.25 2.25 0 018.25 8.25H6A2.25 2.25 0 013.75 6v0zM13.5 6a2.25 2.25 0 012.25-2.25h2.25A2.25 2.25 0 0120.25 6v0a2.25 2.25 0 01-2.25 2.25h-2.25A2.25 2.25 0 0113.5 6v0zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25v0a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25v0z" /></svg>;
const IconShield = () => <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>;

const navItems = [
	{ href: "/", label: "仪表盘", icon: <IconDashboard /> },
	{ href: "/servers", label: "VPS 管理", icon: <IconServer /> },
	{ href: "/health", label: "健康看板", icon: <IconHeart /> },
	{ href: "/traffic", label: "流量中心", icon: <IconTraffic /> },
	{ href: "/files", label: "文件管理", icon: <IconFolder /> },
	{ href: "/downloads", label: "远程下载", icon: <IconDownload /> },
	{ href: "/operation-tasks", label: "任务中心", icon: <IconTask /> },
	{ href: "/shares", label: "分享链接", icon: <IconShare /> },
	{ href: "/backups", label: "备份迁移", icon: <IconBackup /> },
	{ href: "/templates", label: "命令模板", icon: <IconTemplate /> },
	{ href: "/deployments", label: "应用部署", icon: <IconDeploy /> },
	{ href: "/quick-services", label: "快捷服务", icon: <IconStore /> },
	{ href: "/snippets", label: "代码片段", icon: <IconCode /> },
 { href: "/media", label: "媒体库", icon: <IconMovie /> },
 { href: "/image-bed", label: "图床", icon: <IconImage /> },
 { href: "/ai", label: "AI 助手", icon: <IconAi /> },
 { href: "/announcements", label: "站内公告", icon: <IconBell /> },
	{ href: "/tickets", label: "工单请求", icon: <IconTicket /> },
	{ href: "/requests", label: "审批中心", icon: <IconCheck /> },
	{ href: "/scheduled-tasks", label: "定时任务", icon: <IconClock /> },
	{ href: "/alert-rules", label: "智能告警", icon: <IconAlert /> },
	{ href: "/notifications", label: "通知中心", icon: <IconBell /> },
	{ href: "/settings", label: "系统设置", icon: <IconSettings /> },
];

const systemItems = [
	{ href: "/users", label: "用户管理", icon: <IconUsers /> },
	{ href: "/api-tokens", label: "API Token", icon: <IconKey /> },
	{ href: "/status", label: "公开状态页", icon: <IconStatus /> },
	{ href: "/audit", label: "审计日志", icon: <IconAudit /> },
];

/* externalLinks removed — now driven by quickServices prop */

import { getAppName, getPublicLabel } from "@/lib/branding";

interface QuickServiceLink {
	slug: string;
	name: string;
	icon: string;
	path: string;
}

export function AppSidebar({ username, quickServices = [], twoFactorEnabled = false }: { username?: string; quickServices?: QuickServiceLink[]; twoFactorEnabled?: boolean }) {
	const pathname = usePathname();
	const [mobileOpen, setMobileOpen] = useState(false);
	const [passwordModalOpen, setPasswordModalOpen] = useState(false);
	const [twoFactorOpen, setTwoFactorOpen] = useState(false);

	// 登录页不显示侧栏
	if (pathname === "/login") return null;

	const isActive = (href: string) => {
		if (href === "/") return pathname === "/";
		return pathname.startsWith(href);
	};

	const nav = (
		<nav className="flex flex-col h-full">
			{/* Logo */}
			<div className="px-6 py-6 border-b border-white/[0.06]">
				<div className="flex items-center gap-2.5">
					<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400 to-blue-500">
						<svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20"><path d="M10.394 2.08a1 1 0 00-.788 0l-7 3a1 1 0 000 1.84L5.25 8.05 4.646 12.2a1 1 0 00.476 1.006l4.5 2.706a1 1 0 001.056 0l4.5-2.706a1 1 0 00.476-1.006L14.95 8.05l2.644-1.228a1 1 0 000-1.84l-7-3zM10 4.08l5.106 2.19L10 8.49 4.894 6.27 10 4.08z" /></svg>
					</div>
					<div>
						<div className="text-base font-semibold tracking-tight text-white">{getAppName()}</div>
						<p className="text-[10px] text-slate-500 leading-none">{getPublicLabel()}</p>
					</div>
				</div>
			</div>

			{/* Nav Items */}
			<div className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto">
				{navItems.map((item) => (
					<Link
						key={item.href}
						href={item.href}
						onClick={() => setMobileOpen(false)}
						className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm transition-all duration-150 ${
							isActive(item.href)
								? "bg-cyan-400/[0.08] text-cyan-100 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.12)] font-medium"
								: "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"
						}`}
					>
						<span className={isActive(item.href) ? "text-cyan-400" : ""}>{item.icon}</span>
						<span>{item.label}</span>
					</Link>
				))}

				{/* System section */}
				<div className="pt-4 pb-1 px-3.5 text-[10px] uppercase tracking-[0.2em] text-slate-600 font-medium">
					系统管理
				</div>
				{systemItems.map((item) => (
					<Link
						key={item.href}
						href={item.href}
						onClick={() => setMobileOpen(false)}
						className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm transition-all duration-150 ${
							isActive(item.href)
								? "bg-cyan-400/[0.08] text-cyan-100 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.12)] font-medium"
								: "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"
						}`}
					>
						<span className={isActive(item.href) ? "text-cyan-400" : ""}>{item.icon}</span>
						<span>{item.label}</span>
					</Link>
				))}

			{/* Quick service links (dynamic from DB) */}
			{quickServices.length > 0 && (
				<>
					<div className="pt-4 pb-1 px-3.5 text-[10px] uppercase tracking-[0.2em] text-slate-600 font-medium">
						快捷服务
					</div>
					{quickServices.map((item) => (
						<a
							key={item.slug}
							href={item.path}
							target="_blank"
							rel="noopener noreferrer"
							onClick={() => setMobileOpen(false)}
							className="flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm text-slate-400 hover:bg-white/[0.04] hover:text-slate-200 transition-all duration-150"
						>
							<span className="text-[18px] leading-none">{item.icon}</span>
							<span>{item.name}</span>
							<IconExternal />
						</a>
					))}
				</>
			)}
			</div>

			{/* Bottom User Area */}
			<div className="border-t border-white/[0.06] px-3 py-3 space-y-0.5">
			{username && (
					<div className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-400">
						<div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 text-[11px] font-semibold text-cyan-400 uppercase">
							{username[0]}
						</div>
						<span>{username}</span>
						<div className="ml-auto flex items-center gap-1">
							<LanguageToggle />
							<ThemeToggle />
							<NotificationBell />
						</div>
					</div>
			)}
				<button
					onClick={() => {
						setPasswordModalOpen(true);
						setMobileOpen(false);
					}}
					className="w-full flex items-center gap-3 rounded-xl px-3.5 py-2 text-sm text-slate-400 hover:bg-white/[0.04] hover:text-slate-200 transition-all duration-150"
				>
					<IconKey />
					<span>修改密码</span>
				</button>
				<button
					onClick={() => {
						setTwoFactorOpen(true);
						setMobileOpen(false);
					}}
					className="w-full flex items-center gap-3 rounded-xl px-3.5 py-2 text-sm text-slate-400 hover:bg-white/[0.04] hover:text-slate-200 transition-all duration-150"
				>
					<IconShield />
					<span>两步验证</span>
				</button>
				<div className="px-2 py-1">
					<SignOutButton />
				</div>
			</div>
		</nav>
	);

	return (
		<>
			{/* Mobile hamburger */}
			<button
				onClick={() => setMobileOpen(true)}
				className="fixed top-4 left-4 z-50 lg:hidden rounded-xl border border-white/10 bg-slate-950/90 p-2.5 text-slate-200 backdrop-blur hover:bg-white/10 transition"
				aria-label="打开导航菜单"
			>
				<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
					<path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
				</svg>
			</button>

			{/* Mobile overlay */}
			{mobileOpen && (
				<div
					className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
					onClick={() => setMobileOpen(false)}
				/>
			)}

			{/* Mobile sidebar drawer */}
			<aside
				className={`fixed inset-y-0 left-0 z-50 w-64 bg-slate-950 border-r border-white/[0.06] transform transition-transform duration-200 lg:hidden ${
					mobileOpen ? "translate-x-0" : "-translate-x-full"
				}`}
			>
				{nav}
			</aside>

			{/* Desktop sidebar */}
			<aside className="hidden lg:flex w-64 shrink-0 border-r border-white/[0.06] bg-[#0a0e1a] h-screen sticky top-0">
				{nav}
			</aside>

			{/* Password Modal */}
			<ChangePasswordModal
				open={passwordModalOpen}
				onClose={() => setPasswordModalOpen(false)}
			/>

			{/* Two-Factor Auth Modal */}
			{twoFactorOpen && (
				<div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setTwoFactorOpen(false)}>
					<div className="w-full max-w-md mx-4 bg-slate-950 border border-white/[0.08] rounded-2xl p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
						<div className="flex items-center justify-between mb-4">
							<h2 className="text-base font-semibold text-white">安全设置</h2>
							<button onClick={() => setTwoFactorOpen(false)} className="text-slate-500 hover:text-slate-300 transition">
								<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
							</button>
						</div>
						<TwoFactorSettings enabled={twoFactorEnabled} />
					</div>
				</div>
			)}
		</>
	);
}
